import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeInput } from '../dist/input.js';
import { mapProduct } from '../dist/routes.js';

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

test('normalizes default input to one low-cost Allbirds run', () => {
    const input = normalizeInput({});

    assert.deepEqual(input.storeUrls, ['allbirds.com']);
    assert.equal(input.maxProductsPerStore, 1);
    assert.equal(input.productType, '');
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
});

test('maps Shopify products into the public dataset shape', () => {
    const product = mapProduct(shopifyProduct, 'https://allbirds.com', 'allbirds.com', 1);

    assert.equal(product.source, 'shopify');
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
});
