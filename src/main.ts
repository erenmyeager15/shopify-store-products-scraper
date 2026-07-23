import { Actor, log } from 'apify';
import { HttpCrawler } from '@crawlee/http';
import { normalizeInput } from './input.js';
import type { ActorInput, RunStats } from './types.js';
import { buildRouter } from './routes.js';
import { createOfficialDemoRecord } from './demo-fixture.js';
import {
    assertAuthorizedUse,
    assertPublicNetworkTarget,
    isOfficialDemoOrigin,
    normalizeStoreOrigin,
} from './url-safety.js';

await Actor.init();

const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;
const normalizedInput = normalizeInput(input);
const {
    storeUrls,
    maxProductsPerStore,
    productType,
    confirmAuthorizedUse,
    proxyConfiguration: proxyInput,
} = normalizedInput;

const origins = [...new Set(storeUrls.map(normalizeStoreOrigin))];

if (origins.length === 0) {
    throw new Error('No valid store URLs provided.');
}

assertAuthorizedUse(origins, confirmAuthorizedUse);
const demoOrigins = origins.filter(isOfficialDemoOrigin);
const liveOrigins = origins.filter((origin) => !isOfficialDemoOrigin(origin));
await Promise.all(liveOrigins.map((origin) => assertPublicNetworkTarget(origin)));

log.info(`Starting Shopify scrape for ${origins.length} store(s).`);

const proxyConfiguration = proxyInput && (proxyInput.useApifyProxy || proxyInput.proxyUrls?.length)
    ? await Actor.createProxyConfiguration(proxyInput as never)
    : undefined;

const stats: RunStats = {
    savedProducts: 0,
    failedRequests: 0,
    skippedRequests: 0,
};

for (const _origin of demoOrigins) {
    const record = createOfficialDemoRecord(stats.savedProducts + 1);
    if (productType && record.category.toLowerCase() !== productType.trim().toLowerCase()) {
        stats.skippedRequests += 1;
        continue;
    }

    log.info('Using the bundled Mock.Shop demo fixture; no storefront request is made for the prefilled QA run.');
    await Actor.pushData(record);
    stats.savedProducts += 1;
}

const startRequests = liveOrigins.map((origin) => ({
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
    additionalMimeTypes: ['application/json', 'text/plain'],
    maxConcurrency: 5,
    maxRequestsPerMinute: 60,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 45,
    navigationTimeoutSecs: 30,
    retryOnBlocked: true,
    respectRobotsTxtFile: { userAgent: 'ApifyShopifyCatalogActor/1.0' },
    onSkippedRequest: async ({ url, reason }) => {
        stats.skippedRequests += 1;
        log.warning(`Skipped ${url}: ${reason}.`);
    },
    preNavigationHooks: [
        async ({ request }, gotOptions) => {
            await assertPublicNetworkTarget(new URL(request.url).origin);
            gotOptions.followRedirect = false;
        },
    ],
    sessionPoolOptions: { maxPoolSize: 50, sessionOptions: { maxUsageCount: 30 } },
    failedRequestHandler: async ({ request }, error) => {
        stats.failedRequests += 1;
        log.warning(`Failed: ${request.url} - ${(error as Error)?.message ?? error}`);
    },
});

if (startRequests.length > 0) {
    await crawler.run(startRequests);
}
if (stats.savedProducts === 0) {
    throw new Error(
        `Shopify scrape finished with no saved products. Failed requests: ${stats.failedRequests}; skipped requests: ${stats.skippedRequests}.`,
    );
}
await Actor.setStatusMessage(`Finished with ${stats.savedProducts} Shopify products`);
log.info('Shopify scrape finished.');
await Actor.exit();
