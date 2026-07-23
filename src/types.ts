export interface ActorInput {
    storeUrls?: string[];
    maxProductsPerStore?: number;
    productType?: string;
    confirmAuthorizedUse?: boolean;
    proxyConfiguration?: ProxyInput;
}

export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

export interface RunStats {
    savedProducts: number;
    failedRequests: number;
    skippedRequests: number;
}

export interface VariantRecord {
    variantId: number | null;
    title: string | null;
    sku: string | null;
    price: number | null;
    compareAtPrice: number | null;
    available: boolean | null;
    requiresShipping: boolean | null;
    grams: number | null;
}

export interface ProductRecord {
    source: 'shopify';
    dataOrigin: 'live_storefront' | 'bundled_demo';
    isDemo: boolean;
    searchQuery: string;
    position: number;
    productId: string | null;
    title: string;
    brand: string;
    price: number | null;
    mrp: number | null;
    discountPercent: number | null;
    currency: string;
    packSize: string;
    category: string;
    rating: number | null;
    ratingCount: number | null;
    inStock: boolean | null;
    productUrl: string | null;
    imageUrl: string | null;
    scrapedAt: string;
}
