import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeInput } from '../dist/input.js';
import { createOfficialDemoRecord } from '../dist/demo-fixture.js';
import { buildRouter, isBillableProductRecord, mapProduct } from '../dist/routes.js';
import { planStoreRequest, pageSizeFor, pageUrl } from '../dist/request-plan.js';

test('preserves product and collection scope and reduces small-request payloads', () => {
    assert.deepEqual(planStoreRequest('example.com/collections/shoes'), {
        origin: 'https://example.com', endpoint: 'https://example.com/collections/shoes/products.json', single: false,
    });
    assert.equal(planStoreRequest('example.com/collections/shoes/products/red-shoe').endpoint, 'https://example.com/products/red-shoe.json');
    assert.equal(planStoreRequest('example.com/products/red-shoe.json').single, true);
    assert.throws(() => planStoreRequest('example.com/admin'), /Unsupported/);
    assert.throws(() => planStoreRequest('example.com/collections/shoes?filter=blue'), /query/);
    assert.equal(pageSizeFor(1, ''), 1);
    assert.equal(pageSizeFor(1000, ''), 250);
    assert.equal(pageSizeFor(1, 'shoes'), 250);
    assert.equal(pageUrl('https://example.com/products.json', 2, 25, false), 'https://example.com/products.json?limit=25&page=2');
});

test('pairs price and compare-at from the same variant and exposes all variants', () => {
    const record = mapProduct({ ...shopifyProduct, variants: [
        { id: 1, price: '80', compare_at_price: '100', sku: 'a', available: false },
        { id: 2, price: '50', compare_at_price: '200', sku: 'b' },
    ] }, 'https://example.com', 'example.com', 1);
    assert.equal(record.price, 50);
    assert.equal(record.mrp, 200);
    assert.equal(record.discountPercent, 75);
    assert.equal(record.priceMax, 80);
    assert.equal(record.variants.length, 2);
    assert.equal(record.variants[1].sku, 'b');
    assert.equal(record.inStock, null);
    assert.equal(record.images.length, 1);
});

test('rejects corrupt or negative prices rather than charging for them', () => {
    for (const price of ['12USD', '-4', -4, Infinity, '']) {
        const record = mapProduct({ ...shopifyProduct, variants: [{ price }] }, 'https://example.com', 'example.com', 1);
        assert.equal(record.price, null);
        assert.equal(isBillableProductRecord(record), false);
    }
});
import {
    assertAuthorizedUse,
    assertPublicNetworkTarget,
    normalizeStoreOrigin,
} from '../dist/url-safety.js';

const shopifyProduct = {
    id: 7369944137808,
    title: 'Tree Runner - Natural White',
    handle: 'tree-runner-natural-white',
    vendor: 'Allbirds',
    product_type: 'Shoes',
    variants: [
        {
            id: 42436493115472,
            title: 'US 8',
            sku: 'TR-NW-8',
            price: '98.00',
            compare_at_price: '120.00',
            available: true,
            requires_shipping: true,
            grams: 300,
        },
        {
            id: 42436493148240,
            title: 'US 9',
            sku: 'TR-NW-9',
            price: '105.00',
            compare_at_price: null,
            available: false,
            requires_shipping: true,
            grams: 300,
        },
    ],
    images: [
        { src: '//cdn.shopify.com/s/files/example/tree-runner.png' },
    ],
};

function routerHarness(overrides = {}) {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const saved = [], queued = [];
    let aborted = 0;
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats,
        pushData: async (row, event) => { saved.push({ row, event }); return { chargedCount: 1, eventChargeLimitReached: false }; },
        setStatus: async () => {}, ...overrides,
    });
    const run = async (products, userData = {}, single = false) => router({
        body: Buffer.from(JSON.stringify(single ? { product: products[0] } : { products })),
        request: { userData: { origin: 'https://example.com', endpoint: 'https://example.com/products.json',
            storeDomain: 'example.com', page: 1, collected: 0, single, ...userData } },
        crawler: { addRequests: async (requests) => { queued.push(...requests); }, autoscaledPool: { abort: async () => { aborted++; } } },
    });
    return { stats, saved, queued, run, aborted: () => aborted };
}

test('router prevents duplicate billing across requests and enforces cap across store scopes', async () => {
    const h = routerHarness({ maxProductsPerStore: 2 });
    await h.run([shopifyProduct, { ...shopifyProduct, id: 2 }]);
    await h.run([shopifyProduct, { ...shopifyProduct, id: 3 }], { endpoint: 'https://example.com/collections/shoes/products.json' });
    assert.equal(h.saved.length, 2);
    assert.equal(h.stats.savedProducts, 2);
    assert.equal(h.queued.length, 0);
    assert.ok(h.saved.every((row) => row.event === 'product-scraped'));
});

test('router handles single-product responses and valid empty results', async () => {
    const h = routerHarness();
    await h.run([shopifyProduct], {}, true);
    await h.run([]);
    assert.equal(h.saved.length, 1);
    assert.equal(h.queued.length, 0);
    assert.equal(h.stats.validResponses, 2);
});

test('concurrent scopes cannot exceed the per-store cap', async () => {
    const h = routerHarness({ maxProductsPerStore: 1 });
    await Promise.all([h.run([shopifyProduct]), h.run([{ ...shopifyProduct, id: 2 }])]);
    assert.equal(h.saved.length, 1);
});

test('nonempty malformed products do not become a successful empty catalog', async () => {
    const h = routerHarness();
    await assert.rejects(h.run([{ id: 123, title: 'Broken', handle: 'broken' }]), /no matching row/);
    assert.equal(h.saved.length, 0);
});

test('repeated source pages stop filtered pagination without new charges', async () => {
    const h = routerHarness({ productType: 'shoes' });
    const products = Array.from({ length: 250 }, (_, i) => ({ ...shopifyProduct, id: i, product_type: 'Other' }));
    await h.run(products);
    await h.run(products, { page: 2 });
    assert.equal(h.queued.length, 1);
    assert.equal(h.saved.length, 0);
    assert.equal(h.stats.repeatedPage, true);
});

test('router stops on charging limit and never counts the rejected record', async () => {
    let pushes = 0;
    const h = routerHarness({ pushData: async () => { pushes++; return { chargedCount: 0, eventChargeLimitReached: true }; } });
    await h.run([shopifyProduct, { ...shopifyProduct, id: 2 }]);
    await h.run([shopifyProduct]);
    assert.equal(pushes, 1);
    assert.equal(h.stats.savedProducts, 0);
    assert.equal(h.stats.spendingLimitReached, true);
    assert.equal(h.aborted(), 1);
});

test('filtered pagination retains collection endpoint and stops at safety bound', async () => {
    const h = routerHarness({ productType: 'shoes' });
    const products = Array.from({ length: 250 }, (_, i) => ({ ...shopifyProduct, id: i + 1, product_type: 'Other' }));
    await h.run(products, { endpoint: 'https://example.com/collections/red/products.json' });
    assert.equal(h.queued.length, 1);
    assert.equal(h.queued[0].url, 'https://example.com/collections/red/products.json?limit=250&page=2');
    await h.run(products, { page: 20 });
    assert.equal(h.queued.length, 1);
    assert.equal(h.stats.pageLimitReached, true);
});

test('normalizes default input to Shopify official demo', () => {
    const input = normalizeInput({});

    assert.deepEqual(input.storeUrls, ['demostore.mock.shop']);
    assert.equal(input.maxProductsPerStore, 1);
    assert.equal(input.productType, '');
    assert.equal(input.confirmAuthorizedUse, false);
    assert.equal(input.proxyConfiguration, undefined);
});

test('rejects oversized or invalid input values', () => {
    assert.throws(
        () => normalizeInput({ storeUrls: ['a', 'b', 'c', 'd', 'e', 'f'] }),
        /at most 5/,
    );
    assert.throws(
        () => normalizeInput({ storeUrls: ['allbirds.com'], maxProductsPerStore: 0 }),
        /between 1 and 1000/,
    );
    assert.throws(
        () => normalizeInput({ storeUrls: ['allbirds.com'], proxyConfiguration: [] }),
        /proxyConfiguration/,
    );
    assert.throws(
        () => normalizeInput({ confirmAuthorizedUse: 'yes' }),
        /confirmAuthorizedUse/,
    );
});

test('requires explicit authorization for real stores but not the official demo', () => {
    assert.doesNotThrow(() => assertAuthorizedUse(['https://demostore.mock.shop'], false));
    assert.throws(
        () => assertAuthorizedUse(['https://example.myshopify.com'], false),
        /Confirm authorized use/,
    );
    assert.doesNotThrow(() => assertAuthorizedUse(['https://example.myshopify.com'], true));
});

test('accepts HTTPS public hosts and rejects unsafe URL forms', async () => {
    assert.equal(normalizeStoreOrigin('Example.COM/catalog'), 'https://example.com');
    assert.throws(() => normalizeStoreOrigin('http://example.com'), /HTTPS/);
    assert.throws(() => normalizeStoreOrigin('https://user:pass@example.com'), /credentials/);
    assert.throws(() => normalizeStoreOrigin('https://example.com:8443'), /custom port/);
    assert.throws(() => normalizeStoreOrigin('https://127.0.0.1'), /non-public/);

    await assert.doesNotReject(() => assertPublicNetworkTarget(
        'https://example.com',
        async () => [{ address: '93.184.216.34', family: 4 }],
    ));
    await assert.rejects(
        () => assertPublicNetworkTarget(
            'https://example.com',
            async () => [{ address: '169.254.169.254', family: 4 }],
        ),
        /non-public/,
    );
});

test('maps Shopify products into the public dataset shape', () => {
    const product = mapProduct(shopifyProduct, 'https://allbirds.com', 'allbirds.com', 1);

    assert.equal(product.source, 'shopify');
    assert.equal(product.dataOrigin, 'live_storefront');
    assert.equal(product.isDemo, false);
    assert.equal(product.searchQuery, 'allbirds.com');
    assert.equal(product.position, 1);
    assert.equal(product.productId, '7369944137808');
    assert.equal(product.title, 'Tree Runner - Natural White');
    assert.equal(product.brand, 'Allbirds');
    assert.equal(product.price, 98);
    assert.equal(product.mrp, 120);
    assert.equal(product.discountPercent, 18);
    assert.equal(product.currency, 'N/A');
    assert.equal(product.packSize, 'US 8');
    assert.equal(product.category, 'Shoes');
    assert.equal(product.rating, null);
    assert.equal(product.ratingCount, null);
    assert.equal(product.inStock, true);
    assert.equal(product.productUrl, 'https://allbirds.com/products/tree-runner-natural-white');
    assert.equal(product.imageUrl, 'https://cdn.shopify.com/s/files/example/tree-runner.png');
    assert.equal(isBillableProductRecord(product), true);
});

test('creates a transparent, valid bundled record for the official QA demo', () => {
    const product = createOfficialDemoRecord();

    assert.equal(product.source, 'shopify');
    assert.equal(product.dataOrigin, 'bundled_demo');
    assert.equal(product.isDemo, true);
    assert.equal(product.searchQuery, 'demostore.mock.shop');
    assert.equal(product.title, 'Hoodie');
    assert.equal(product.price, 90);
    assert.equal(product.productUrl, 'https://demostore.mock.shop/products/hoodie');
    assert.equal(isBillableProductRecord(product), true);
});

test('does not treat incomplete product rows as billable output', () => {
    const product = mapProduct({ id: 1, title: 'Incomplete', handle: 'incomplete' }, 'https://example.com', 'example.com', 1);
    assert.equal(product.price, null);
    assert.equal(isBillableProductRecord(product), false);
});
