export interface ActorInput {
    storeUrls?: string[];
    maxProductsPerStore?: number;
    productType?: string;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        proxyUrls?: string[];
    };
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
    productId: number | null;
    title: string | null;
    handle: string | null;
    description: string | null;
    vendor: string | null;
    productType: string | null;
    tags: string[];
    storeDomain: string;
    productUrl: string;
    minPrice: number | null;
    maxPrice: number | null;
    currency: string | null;
    available: boolean;
    variantsCount: number;
    variants: VariantRecord[];
    imageUrl: string | null;
    images: string[];
    options: { name: string | null; values: string[] }[];
    createdAt: string | null;
    updatedAt: string | null;
    publishedAt: string | null;
    scrapedAt: string;
}
