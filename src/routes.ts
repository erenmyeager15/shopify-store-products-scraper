import { Actor, log } from 'apify';
import type { HttpCrawlingContext } from 'crawlee';
import type { ProductRecord, VariantRecord } from './types.js';

interface RouterOpts {
    maxProductsPerStore: number;
    productType: string;
}

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

function parseBody(ctx: HttpCrawlingContext): any {
    const anyCtx = ctx as any;
    if (anyCtx.json !== undefined && anyCtx.json !== null) return anyCtx.json;
    const raw = ctx.body?.toString?.() ?? '';
    const t = raw.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) {
        throw new Error('Non-JSON response (store blocked or not a Shopify store). Rotating session.');
    }
    return JSON.parse(t);
}

function mapProduct(p: any, origin: string, storeDomain: string): ProductRecord {
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
    const images: string[] = Array.isArray(p.images)
        ? p.images.map((img: any) => img?.src).filter((s: any) => typeof s === 'string')
        : [];
    const options = Array.isArray(p.options)
        ? p.options.map((o: any) => ({ name: o?.name ?? null, values: Array.isArray(o?.values) ? o.values : [] }))
        : [];

    return {
        productId: toNum(p.id),
        title: p.title ?? null,
        handle: p.handle ?? null,
        description: stripHtml(p.body_html),
        vendor: p.vendor ?? null,
        productType: p.product_type ?? null,
        tags: Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? p.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []),
        storeDomain,
        productUrl: p.handle ? `${origin}/products/${p.handle}` : origin,
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        currency: null,
        available: variants.some((v) => v.available),
        variantsCount: variants.length,
        variants,
        imageUrl: images[0] ?? null,
        images,
        options,
        createdAt: p.created_at ?? null,
        updatedAt: p.updated_at ?? null,
        publishedAt: p.published_at ?? null,
        scrapedAt: new Date().toISOString(),
    };
}

export function buildRouter(opts: RouterOpts) {
    const { maxProductsPerStore, productType } = opts;

    return async (ctx: HttpCrawlingContext): Promise<void> => {
        const { request, crawler } = ctx;
        const { storeDomain, origin, page, collected } = request.userData as {
            storeDomain: string;
            origin: string;
            page: number;
            collected: number;
        };

        const data = parseBody(ctx);
        const products: any[] = Array.isArray(data?.products) ? data.products : [];

        if (products.length === 0) {
            log.info(`${storeDomain}: no more products (page ${page}). Total ${collected}.`);
            return;
        }

        let count = collected;
        let pushedThisPage = 0;
        for (const p of products) {
            if (count >= maxProductsPerStore) break;
            if (productType && String(p.product_type ?? '').toLowerCase() !== productType) continue;

            await Actor.pushData(mapProduct(p, origin, storeDomain));
            await Actor.charge({ eventName: 'product-scraped' }).catch(() => null);
            count++;
            pushedThisPage++;
        }

        log.info(`${storeDomain}: pushed ${pushedThisPage} products (total ${count}/${maxProductsPerStore}) [page ${page}]`);

        // Paginate while the page was full and we're under the cap.
        if (count < maxProductsPerStore && products.length >= 250) {
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
