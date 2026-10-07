import { Actor, log } from 'apify';
import type { HttpCrawlingContext } from '@crawlee/http';
import type { ProductRecord, RunStats, VariantRecord } from './types.js';
import { pageSizeFor, pageUrl } from './request-plan.js';

interface RouterOpts {
    maxProductsPerStore: number;
    productType: string;
    stats: RunStats;
    pushData?: (record: ProductRecord, eventName: string) => Promise<{ chargedCount: number; eventChargeLimitReached: boolean }>;
    setStatus?: (message: string) => Promise<unknown>;
}

const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_PRODUCTS_PER_PAGE = 250;

const toNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        if (!/^\d+(?:\.\d+)?$/.test(v.trim())) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

const stripHtml = (html: unknown): string | null => {
    if (typeof html !== 'string' || !html.trim()) return null;
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim() || null;
};

const textOrNA = (value: unknown): string => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text || 'N/A';
};

const normalizeUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'Proxied content') return null;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
    return trimmed;
};

const discountPercent = (price: number | null, mrp: number | null): number | null => {
    if (price === null || mrp === null || mrp <= price || mrp <= 0) return null;
    return Math.round(((mrp - price) / mrp) * 100);
};

function parseBody(ctx: HttpCrawlingContext): any {
    const raw = ctx.body?.toString?.() ?? '';
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error(`Shopify response exceeded the ${MAX_RESPONSE_BYTES} byte safety limit.`);
    }

    const anyCtx = ctx as any;
    if (anyCtx.json !== undefined && anyCtx.json !== null) return anyCtx.json;
    const t = raw.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) {
        throw new Error('Non-JSON response (store blocked or not a Shopify store). Rotating session.');
    }
    return JSON.parse(t);
}

export function isBillableProductRecord(record: ProductRecord): boolean {
    return record.productId !== null
        && record.title !== 'N/A'
        && record.price !== null
        && record.productUrl !== null;
}

export function mapProduct(
    p: any,
    origin: string,
    storeDomain: string,
    position: number,
    dataOrigin: ProductRecord['dataOrigin'] = 'live_storefront',
): ProductRecord {
    const variants: VariantRecord[] = Array.isArray(p.variants)
        ? p.variants.filter((v: unknown) => v !== null && typeof v === 'object').map((v: any) => ({
              variantId: Number.isSafeInteger(toNum(v.id)) ? toNum(v.id) : null,
              title: v.title ?? null,
              sku: v.sku ? String(v.sku) : null,
              price: toNum(v.price),
              compareAtPrice: toNum(v.compare_at_price),
              available: typeof v.available === 'boolean' ? v.available : null,
              requiresShipping: typeof v.requires_shipping === 'boolean' ? v.requires_shipping : null,
              grams: toNum(v.grams),
          }))
        : [];

    const prices = variants.map((v) => v.price).filter((x): x is number => x != null);
    const images: string[] = Array.isArray(p.images)
        ? p.images.map((img: any) => img?.src).filter((s: any) => typeof s === 'string')
        : [];
    const firstVariantTitle = variants.find((variant) => variant.title && variant.title !== 'Default Title')?.title;
    const price = prices.length ? Math.min(...prices) : null;
    // A discount must compare the SAME variant, not two unrelated minima.
    const mrp = price === null ? null : variants.find((v) => v.price === price)?.compareAtPrice ?? null;
    const availability = variants.map((v) => v.available);

    return {
        source: 'shopify',
        dataOrigin,
        isDemo: dataOrigin === 'bundled_demo',
        searchQuery: textOrNA(storeDomain),
        position,
        productId: p.id === null || p.id === undefined ? null : String(p.id),
        title: textOrNA(p.title),
        brand: textOrNA(p.vendor),
        price,
        mrp,
        discountPercent: discountPercent(price, mrp),
        currency: 'N/A',
        packSize: textOrNA(firstVariantTitle),
        category: textOrNA(p.product_type),
        rating: null,
        ratingCount: null,
        inStock: availability.includes(true) ? true : availability.length && availability.length === p.variants.length && availability.every((v) => v === false) ? false : null,
        productUrl: typeof p.handle === 'string' && /^[a-zA-Z0-9_-]+$/.test(p.handle) ? `${origin}/products/${p.handle}` : null,
        imageUrl: normalizeUrl(images[0]),
        scrapedAt: new Date().toISOString(),
        variants,
        priceMax: prices.length ? Math.max(...prices) : null,
        images: [...new Set(images.map(normalizeUrl).filter((v): v is string => v !== null))],
        description: stripHtml(p.body_html),
        tags: (Array.isArray(p.tags) ? p.tags : typeof p.tags === 'string' ? p.tags.split(',') : [])
            .filter((v: unknown): v is string => typeof v === 'string').map((v: string) => v.trim()).filter(Boolean),
    };
}

export function buildRouter(opts: RouterOpts) {
    const { maxProductsPerStore, productType, stats } = opts;
    let spendingLimitReached = false;
    let chargedProductCount = 0;
    const seen = new Set<string>();
    const storeCounts = new Map<string, number>();
    const pageSignatures = new Set<string>();
    const storeLocks = new Map<string, Promise<void>>();

    const handle = async (ctx: HttpCrawlingContext): Promise<void> => {
        const { request, crawler } = ctx;

        if (spendingLimitReached || stats.spendingLimitReached) return;

        const { storeDomain, origin, page, collected, endpoint, single } = request.userData as {
            storeDomain: string;
            origin: string;
            page: number;
            collected: number;
            endpoint: string;
            single: boolean;
        };

        const data = parseBody(ctx);
        if (!data || typeof data !== 'object' || (single ? !data.product || typeof data.product !== 'object' : !Array.isArray(data.products))) {
            throw new Error('Response is not a Shopify products payload.');
        }

        const products: any[] = single ? [data.product] : data.products;
        if (products.length > MAX_PRODUCTS_PER_PAGE) {
            throw new Error(`Shopify response contained more than ${MAX_PRODUCTS_PER_PAGE} products.`);
        }
        stats.validResponses = (stats.validResponses ?? 0) + 1;

        if (products.length === 0) {
            log.info(`${storeDomain}: no more products (page ${page}). Total ${collected}.`);
            return;
        }

        let count = storeCounts.get(origin) ?? 0;
        let pushedThisPage = 0;
        let skippedInvalidThisPage = 0;

        for (const p of products) {
            if (count >= maxProductsPerStore || spendingLimitReached) break;
            if (!p || typeof p !== 'object') { skippedInvalidThisPage++; continue; }
            if (productType && String(p.product_type ?? '').toLowerCase() !== productType) continue;

            const record = mapProduct(p, origin, storeDomain, count + 1);
            if (!isBillableProductRecord(record)) {
                skippedInvalidThisPage += 1;
                continue;
            }
            const key = `${origin}:${record.productId}`;
            if (seen.has(key)) continue;

            const chargeResult = await (opts.pushData ?? ((row, event) => Actor.pushData(row, event)))(record, 'product-scraped');
            const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
            if (recordWasSaved) {
                seen.add(key);
                count += 1;
                pushedThisPage += 1;
                chargedProductCount += 1;
                stats.savedProducts += 1;
                storeCounts.set(origin, count);
            }

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                stats.spendingLimitReached = true;
                await (opts.setStatus ?? ((message) => Actor.setStatusMessage(message)))(`Stopped at the user's spending limit after ${chargedProductCount} products`);
                log.warning('User spending limit reached; stopping before more Shopify requests.');
                await crawler.autoscaledPool?.abort();
                break;
            }
        }
        if (skippedInvalidThisPage > 0 && pushedThisPage === 0 && count === 0 && !spendingLimitReached) {
            throw new Error('Shopify returned product rows, but no matching row had valid billing fields.');
        }
        const signature = `${endpoint}:${products.map((product) => product?.id ?? product?.handle ?? '').join('|')}`;
        if (page > 1 && pageSignatures.has(signature)) {
            stats.repeatedPage = true;
            log.warning(`${storeDomain}: source repeated an earlier page; pagination stopped without duplicate charges.`);
            return;
        }
        pageSignatures.add(signature);

        log.info(`${storeDomain}: pushed ${pushedThisPage} products (total ${count}/${maxProductsPerStore}) [page ${page}]`, {
            skippedInvalidThisPage,
        });
        if (page >= 20 && count < maxProductsPerStore && products.length >= pageSizeFor(maxProductsPerStore, productType)) {
            stats.pageLimitReached = true;
            log.warning(`${storeDomain}: stopped at the 20-page safety limit; results may be partial.`);
        }

        // Paginate while the page was full and we're under the cap.
        if (!single && !spendingLimitReached && count < maxProductsPerStore && page < 20
            && products.length >= pageSizeFor(maxProductsPerStore, productType)
            && (pushedThisPage > 0 || productType !== '')) {
            const nextPage = page + 1;
            await crawler.addRequests([
                {
                    url: pageUrl(endpoint, nextPage, pageSizeFor(maxProductsPerStore, productType), false),
                    userData: { storeDomain, origin, endpoint, single, page: nextPage, collected: count },
                },
            ]);
        }
    };
    // Multiple collection URLs from the same store may complete concurrently.
    // Serialize persistence per store so the cap and dedup checks remain atomic.
    return async (ctx: HttpCrawlingContext): Promise<void> => {
        const key = String(ctx.request.userData.origin);
        const previous = storeLocks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        storeLocks.set(key, pending);
        await previous;
        try { await handle(ctx); }
        finally { release(); if (storeLocks.get(key) === pending) storeLocks.delete(key); }
    };
}
