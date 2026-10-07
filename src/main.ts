import { Actor, log } from 'apify';
import { HttpCrawler } from '@crawlee/http';
import { normalizeInput } from './input.js';
import type { ActorInput, RunStats } from './types.js';
import { buildRouter } from './routes.js';
import { createOfficialDemoRecord } from './demo-fixture.js';
import { planStoreRequest, pageUrl, pageSizeFor } from './request-plan.js';
import {
    assertAuthorizedUse,
    assertPublicNetworkTarget,
    isOfficialDemoOrigin,
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

const plans = [...new Map(storeUrls.map((raw) => { const plan = planStoreRequest(raw); return [plan.endpoint, plan] as const; })).values()];
const origins = [...new Set(plans.map((plan) => plan.origin))];

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
const charging = Actor.getChargingManager();
function hasProductAllowance(): boolean {
    return !charging.getPricingInfo().isPayPerEvent
        || charging.calculateMaxEventChargeCountWithinLimit('product-scraped') >= 1;
}

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

const startRequests = plans.filter((plan) => !isOfficialDemoOrigin(plan.origin)).map(({ origin, endpoint, single }) => ({
    url: pageUrl(endpoint, 1, pageSizeFor(maxProductsPerStore, productType), single),
    userData: { storeDomain: new URL(origin).host, origin, endpoint, single, page: 1, collected: 0 },
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
    maxConcurrency: 2,
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
            if (!hasProductAllowance()) {
                stats.spendingLimitReached = true;
                request.noRetry = true;
                throw new Error('Product spending allowance exhausted before fetching the next page.');
            }
            await assertPublicNetworkTarget(new URL(request.url).origin);
            gotOptions.followRedirect = false;
        },
    ],
    sessionPoolOptions: { maxPoolSize: 50, sessionOptions: { maxUsageCount: 30 } },
    failedRequestHandler: async ({ request }, error) => {
        if (stats.spendingLimitReached) return;
        stats.failedRequests += 1;
        log.warning(`Failed: ${request.url} - ${(error as Error)?.message ?? error}`);
    },
});

if (startRequests.length > 0 && hasProductAllowance()) {
    await crawler.run(startRequests);
} else if (startRequests.length > 0) {
    stats.spendingLimitReached = true;
}
await Actor.setValue('RUN_SUMMARY', { ...stats,
    partial: stats.failedRequests > 0 || stats.skippedRequests > 0 || !!stats.pageLimitReached || !!stats.repeatedPage,
});
if (stats.savedProducts === 0 && !stats.spendingLimitReached && !(stats.validResponses && stats.failedRequests === 0 && stats.skippedRequests === 0)) {
    throw new Error(
        `Shopify scrape finished with no saved products. Failed requests: ${stats.failedRequests}; skipped requests: ${stats.skippedRequests}.`,
    );
}
await Actor.setStatusMessage(`${stats.spendingLimitReached ? 'Stopped at spending limit' : 'Finished'} with ${stats.savedProducts} Shopify products; ${stats.failedRequests} failed requests`);
log.info('Shopify scrape finished.');
await Actor.exit();
