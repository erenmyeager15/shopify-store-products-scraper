import { normalizeStoreOrigin } from './url-safety.js';

export interface RequestPlan {
    origin: string;
    endpoint: string;
    single: boolean;
}

export function planStoreRequest(raw: string): RequestPlan {
    const origin = normalizeStoreOrigin(raw);
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    const path = url.pathname.replace(/\/$/, '');
    if (url.search || url.hash) throw new Error('Use a clean store, collection or product URL without query parameters or fragments.');
    if (path === '' || path === '/products' || path === '/products.json') {
        return { origin, endpoint: `${origin}/products.json`, single: false };
    }
    const product = path.match(/^\/(?:collections\/[^/]+\/)?products\/([a-zA-Z0-9_-]+)(?:\.json)?$/);
    if (product) return { origin, endpoint: `${origin}/products/${product[1]}.json`, single: true };
    const collection = path.match(/^\/collections\/([a-zA-Z0-9_-]+)(?:\/products(?:\.json)?)?$/);
    if (collection) return { origin, endpoint: `${origin}/collections/${collection[1]}/products.json`, single: false };
    throw new Error('Unsupported Shopify path. Use the store root, /collections/handle or /products/handle; the Actor will not silently scrape a different scope.');
}

export function pageUrl(endpoint: string, page: number, pageSize: number, single: boolean): string {
    return single ? endpoint : `${endpoint}?limit=${pageSize}&page=${page}`;
}

export function pageSizeFor(maxProducts: number, productType: string): number {
    // Filtering can discard records. Otherwise do not download 250 products for a one-product task.
    return productType ? 250 : Math.min(250, maxProducts);
}
