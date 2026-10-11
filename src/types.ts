export interface ActorInput {
    storeUrls?: string[];
    maxProductsPerStore?: number;
    productType?: string;
    confirmAuthorizedUse?: boolean;
    trackChanges?: boolean;
    watchlistName?: string;
    maxHistoryPoints?: number;
    storeCurrency?: string;
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
    validResponses?: number;
    spendingLimitReached?: boolean;
    pageLimitReached?: boolean;
    repeatedPage?: boolean;
    retryAttempts?: number;
    recoveredRequests?: number;
    rateLimitResponses?: number;
    rateLimitStops?: number;
    invalidProducts?: number;
    endpoints?: Record<string, EndpointCoverage>;
}

export interface EndpointCoverage {
    origin: string;
    successfulPages: number;
    complete: boolean;
    stopReason: 'pending' | 'exhausted' | 'product_limit' | 'page_limit' | 'repeated_page' | 'failed' | 'skipped' | 'spending_limit';
    invalidProducts: number;
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
    variants: VariantRecord[];
    priceMax: number | null;
    images: string[];
    description: string | null;
    tags: string[];
    currencySource?: 'not_exposed' | 'user_declared';
    watchlistName?: string;
    monitoringStatus?: 'baseline' | 'newly_observed' | 'changed' | 'unchanged' | 'unavailable';
    changes?: string[];
    variantChanges?: VariantChange[];
    previousPrice?: number | null;
    priceChange?: number | null;
    priceChangePercent?: number | null;
    previousInStock?: boolean | null;
    firstObservedAt?: string;
    observationCount?: number;
    historyPoints?: number;
    minObservedPrice?: number | null;
    maxObservedPrice?: number | null;
    priceComparisonBasis?: 'user_declared_same_currency' | 'unverified_currency' | 'no_previous_observation';
    dataQualityWarnings?: string[];
}

export interface VariantChange {
    variantId: number;
    sku: string | null;
    changes: string[];
    previousPrice: number | null;
    price: number | null;
    priceChange: number | null;
    priceChangePercent: number | null;
    previousAvailable: boolean | null;
    available: boolean | null;
}
