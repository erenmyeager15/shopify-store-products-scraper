import { Actor, log } from 'apify';
import { HttpCrawler } from 'crawlee';
import { normalizeInput } from './input.js';
import type { ActorInput, RunStats } from './types.js';
import { buildRouter } from './routes.js';

await Actor.init();

const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;
const normalizedInput = normalizeInput(input);
const { storeUrls, maxProductsPerStore, productType, proxyConfiguration: proxyInput } = normalizedInput;

/** Extract the store origin (https://host) from a domain, URL, or messy input. */
function toOrigin(raw: string): string | null {
    let s = raw.trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        return `${u.protocol}//${u.host}`;
    } catch {
        return null;
    }
}

const origins = [...new Set(storeUrls.map(toOrigin).filter((x): x is string => !!x))];

if (origins.length === 0) {
    throw new Error('No valid store URLs provided. Add at least one Shopify store domain, e.g. "allbirds.com".');
}

log.info(`Starting Shopify scrape for ${origins.length} store(s).`);

const proxyConfiguration = proxyInput && (proxyInput.useApifyProxy || proxyInput.proxyUrls?.length)
    ? await Actor.createProxyConfiguration(proxyInput as never)
    : undefined;

const stats: RunStats = {
    savedProducts: 0,
    failedRequests: 0,
};

const startRequests = origins.map((origin) => ({
    url: `${origin}/products.json?limit=250&page=1`,
    userData: { storeDomain: new URL(origin).host, origin, page: 1, collected: 0 },
}));

const router = buildRouter({
    maxProductsPerStore,
    productType: productType.trim().toLowerCase(),
    stats,
});

const crawler = new HttpCrawler({
    proxyConfiguration,
    requestHandler: router,
    additionalMimeTypes: ['application/json'],
    maxConcurrency: 10,
    maxRequestRetries: 4,
    requestHandlerTimeoutSecs: 90,
    retryOnBlocked: true,
    sessionPoolOptions: { maxPoolSize: 50, sessionOptions: { maxUsageCount: 30 } },
    failedRequestHandler: async ({ request }, error) => {
        stats.failedRequests += 1;
        log.warning(`Failed: ${request.url} - ${(error as Error)?.message ?? error}`);
    },
});

await crawler.run(startRequests);
if (stats.savedProducts === 0) {
    throw new Error(`Shopify scrape finished with no saved products. Failed requests: ${stats.failedRequests}.`);
}
await Actor.setStatusMessage(`Finished with ${stats.savedProducts} Shopify products`);
log.info('Shopify scrape finished.');
await Actor.exit();
