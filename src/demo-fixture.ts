import { mapProduct } from './routes.js';
import type { ProductRecord } from './types.js';
import { OFFICIAL_DEMO_HOST } from './url-safety.js';

export const OFFICIAL_DEMO_PRODUCT = {
    id: 10489561382934,
    title: 'Hoodie',
    handle: 'hoodie',
    vendor: 'Mock.shop',
    product_type: '',
    variants: [
        {
            id: 44283910299901,
            title: 'Clay / Small',
            sku: 'MOCK-HOODIE-CLAY-S',
            price: '90.00',
            compare_at_price: null,
            available: true,
            requires_shipping: true,
            grams: 450,
        },
    ],
    images: [
        {
            src: 'https://cdn.shopify.com/s/files/1/0688/1755/1382/products/ClayHoodie01.jpg',
        },
    ],
};

export function createOfficialDemoRecord(position = 1): ProductRecord {
    const origin = `https://${OFFICIAL_DEMO_HOST}`;
    return mapProduct(OFFICIAL_DEMO_PRODUCT, origin, OFFICIAL_DEMO_HOST, position, 'bundled_demo');
}
