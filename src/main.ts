import { Actor, log } from 'apify';
import { HttpCrawler } from 'crawlee';
import type { ActorInput } from './types.js';
import { buildRouter } from './routes.js';

await Actor.init();

const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;
const {
    storeUrls = [],
    maxProductsPerStore = 1000,
    productType = '',
    proxyConfiguration: proxyInput,
} = input;

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
    log.error('No valid store URLs provided. Add at least one Shopify store domain, e.g. "allbirds.com".');
    await Actor.exit();
}

log.info(`Starting Shopify scrape for ${origins.length} store(s).`);

const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput ?? { useApifyProxy: true });

const startRequests = origins.map((origin) => ({
    url: `${origin}/products.json?limit=250&page=1`,
    userData: { storeDomain: new URL(origin).host, origin, page: 1, collected: 0 },
}));

const router = buildRouter({
    maxProductsPerStore: maxProductsPerStore && maxProductsPerStore > 0 ? maxProductsPerStore : Number.POSITIVE_INFINITY,
    productType: productType.trim().toLowerCase(),
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
        log.warning(`Failed: ${request.url} - ${(error as Error)?.message ?? error}`);
    },
});

await crawler.run(startRequests);
log.info('Shopify scrape finished.');
await Actor.exit();
