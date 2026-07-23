import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeInput } from '../dist/input.js';
import { createOfficialDemoRecord } from '../dist/demo-fixture.js';
import { isBillableProductRecord, mapProduct } from '../dist/routes.js';
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
