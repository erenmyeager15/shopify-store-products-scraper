import { Actor, log } from 'apify';
import type { HttpCrawlingContext } from '@crawlee/http';
import type { ProductRecord, RunStats, VariantRecord } from './types.js';

interface RouterOpts {
    maxProductsPerStore: number;
    productType: string;
    stats: RunStats;
}

const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_PRODUCTS_PER_PAGE = 250;

const toNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = parseFloat(v);
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

export function mapProduct(p: any, origin: string, storeDomain: string, position: number): ProductRecord {
    const variants: VariantRecord[] = Array.isArray(p.variants)
        ? p.variants.map((v: any) => ({
              variantId: toNum(v.id),
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
    const comparePrices = variants.map((v) => v.compareAtPrice).filter((x): x is number => x != null);
    const images: string[] = Array.isArray(p.images)
        ? p.images.map((img: any) => img?.src).filter((s: any) => typeof s === 'string')
        : [];
    const firstVariantTitle = variants.find((variant) => variant.title && variant.title !== 'Default Title')?.title;
    const price = prices.length ? Math.min(...prices) : null;
    const mrp = comparePrices.length ? Math.min(...comparePrices) : null;

    return {
        source: 'shopify',
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
        inStock: variants.length ? variants.some((v) => v.available) : null,
        productUrl: normalizeUrl(p.handle ? `${origin}/products/${p.handle}` : origin),
        imageUrl: normalizeUrl(images[0]),
        scrapedAt: new Date().toISOString(),
    };
}

export function buildRouter(opts: RouterOpts) {
    const { maxProductsPerStore, productType, stats } = opts;
    let spendingLimitReached = false;
    let chargedProductCount = 0;

    return async (ctx: HttpCrawlingContext): Promise<void> => {
        const { request, crawler } = ctx;

        if (spendingLimitReached) return;

        const { storeDomain, origin, page, collected } = request.userData as {
            storeDomain: string;
            origin: string;
            page: number;
            collected: number;
        };

        const data = parseBody(ctx);
        if (!data || typeof data !== 'object' || !Array.isArray(data.products)) {
            throw new Error('Response is not a Shopify products payload.');
        }

        const products: any[] = data.products;
        if (products.length > MAX_PRODUCTS_PER_PAGE) {
            throw new Error(`Shopify response contained more than ${MAX_PRODUCTS_PER_PAGE} products.`);
        }

        if (products.length === 0) {
            log.info(`${storeDomain}: no more products (page ${page}). Total ${collected}.`);
            return;
        }

        let count = collected;
        let pushedThisPage = 0;
        let skippedInvalidThisPage = 0;

        for (const p of products) {
            if (count >= maxProductsPerStore || spendingLimitReached) break;
            if (productType && String(p.product_type ?? '').toLowerCase() !== productType) continue;

            const record = mapProduct(p, origin, storeDomain, count + 1);
            if (!isBillableProductRecord(record)) {
                skippedInvalidThisPage += 1;
                continue;
            }

            const chargeResult = await Actor.pushData(record, 'product-scraped');
            const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
            if (recordWasSaved) {
                count += 1;
                pushedThisPage += 1;
                chargedProductCount += 1;
                stats.savedProducts += 1;
            }

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                await Actor.setStatusMessage(`Stopped at the user's spending limit after ${chargedProductCount} products`);
                log.warning('User spending limit reached; stopping before more Shopify requests.');
                await crawler.autoscaledPool?.abort();
                break;
            }
        }

        log.info(`${storeDomain}: pushed ${pushedThisPage} products (total ${count}/${maxProductsPerStore}) [page ${page}]`, {
            skippedInvalidThisPage,
        });

        // Paginate while the page was full and we're under the cap.
        if (!spendingLimitReached && count < maxProductsPerStore && products.length >= 250) {
            const nextPage = page + 1;
            await crawler.addRequests([
                {
                    url: `${origin}/products.json?limit=250&page=${nextPage}`,
                    userData: { storeDomain, origin, page: nextPage, collected: count },
                },
            ]);
        }
    };
}
