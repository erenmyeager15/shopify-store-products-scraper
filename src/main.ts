import { Actor, log } from 'apify';
import { HttpCrawler, type HttpCrawlingContext } from '@crawlee/http';
import { normalizeInput } from './input.js';
import type { ActorInput, RunStats } from './types.js';
import { buildRouter } from './routes.js';
import { createOfficialDemoRecord } from './demo-fixture.js';
import { planStoreRequest, pageUrl, pageSizeFor } from './request-plan.js';
import { assertAuthorizedUse, assertPublicNetworkTarget, isOfficialDemoOrigin } from './url-safety.js';
import { monitorScopes, ShopifyMonitor, watchlistStoreName, withCurrency } from './monitoring.js';
import { finalizeMonitoring, runSummary } from './reporting.js';
import { createRetryPolicy } from './retry-policy.js';

await Actor.init();

const normalizedInput = normalizeInput(((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput);
const { storeUrls, maxProductsPerStore, productType, confirmAuthorizedUse, trackChanges,
    watchlistName, storeCurrency, proxyConfiguration: proxyInput } = normalizedInput;
const plans = [...new Map(storeUrls.map((raw) => {
    const plan = planStoreRequest(raw); return [plan.endpoint, plan] as const;
})).values()];
const origins = [...new Set(plans.map((p) => p.origin))];
assertAuthorizedUse(origins, confirmAuthorizedUse);
const livePlans = plans.filter((p) => !isOfficialDemoOrigin(p.origin));
const stats: RunStats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0, invalidProducts: 0,
    retryAttempts: 0, recoveredRequests: 0, rateLimitResponses: 0, rateLimitStops: 0,
    endpoints: Object.fromEntries(livePlans.map((p) => [p.endpoint, {
        origin: p.origin, successfulPages: 0, complete: false, stopReason: 'pending' as const, invalidProducts: 0,
    }])) };
const charging = Actor.getChargingManager();
function hasProductAllowance(): boolean {
    return !charging.getPricingInfo().isPayPerEvent
        || charging.calculateMaxEventChargeCountWithinLimit('product-scraped') >= 1;
}

for (const _origin of origins.filter(isOfficialDemoOrigin)) {
    const record = createOfficialDemoRecord(stats.savedProducts + 1);
    if (productType && record.category.toLowerCase() !== productType) { stats.validResponses = (stats.validResponses ?? 0) + 1; continue; }
    log.info('Using the labeled bundled Mock.Shop fixture; no storefront request or product fee.');
    await Actor.pushData(record);
    stats.savedProducts++;
}

let monitor: ShopifyMonitor | undefined;
let fatalStage: string | undefined;
let monitoringCommitFailed = false;
let monitoringHistoryWithheld = false;
if (livePlans.length && !hasProductAllowance()) {
    stats.spendingLimitReached = true;
    for (const c of Object.values(stats.endpoints!)) c.stopReason = 'spending_limit';
} else if (livePlans.length) {
    try {
        fatalStage = 'network_validation';
        await Promise.all([...new Set(livePlans.map((p) => p.origin))].map((origin) => assertPublicNetworkTarget(origin)));
        if (trackChanges) {
            fatalStage = 'history_load';
            const store = await Actor.openKeyValueStore(watchlistStoreName(watchlistName));
            monitor = await ShopifyMonitor.load(monitorScopes(livePlans, normalizedInput), {
                getValue: (key) => store.getValue(key), setValue: (key, value) => store.setValue(key, value),
            }, normalizedInput);
        }
        fatalStage = 'proxy_setup';
        const proxyConfiguration = proxyInput && (proxyInput.useApifyProxy || proxyInput.proxyUrls?.length)
            ? await Actor.createProxyConfiguration(proxyInput as never) : undefined;
        const router = buildRouter({ maxProductsPerStore, productType, stats, canContinue: hasProductAllowance,
            prepareRecord: (record) => monitor ? monitor.prepare(record) : withCurrency(record, storeCurrency),
            recordSaved: (record) => monitor?.saved(record) });
        const retryPolicy = createRetryPolicy(stats, hasProductAllowance);
        const crawler = new HttpCrawler({
            proxyConfiguration, requestHandler: async (ctx: HttpCrawlingContext) => {
                const endpoint = String(ctx.request.userData.endpoint);
                const before = stats.endpoints?.[endpoint]?.successfulPages ?? 0;
                await router(ctx);
                if ((stats.endpoints?.[endpoint]?.successfulPages ?? 0) > before) retryPolicy.recordRecovered(ctx.request);
            },
            additionalMimeTypes: ['application/json', 'text/plain'],
            maxConcurrency: 2, maxRequestsPerMinute: 60, maxRequestRetries: 1,
            sameDomainDelaySecs: 1, maxSessionRotations: 1,
            requestHandlerTimeoutSecs: 45, navigationTimeoutSecs: 30,
            retryOnBlocked: false,
            errorHandler: async (ctx) => retryPolicy.beforeRetry(ctx),
            respectRobotsTxtFile: { userAgent: 'ApifyShopifyCatalogActor/1.0' },
            onSkippedRequest: async ({ url }) => {
                stats.skippedRequests++;
                const endpoint = url.split('?')[0];
                const c = stats.endpoints?.[endpoint];
                if (c) { c.complete = false; c.stopReason = 'skipped'; }
                log.warning('A Shopify request was skipped by access/scope rules; see coverage summary.');
            },
            preNavigationHooks: [async ({ request }, gotOptions) => {
                if (!hasProductAllowance()) {
                    stats.spendingLimitReached = true;
                    request.noRetry = true;
                    const c = stats.endpoints?.[String(request.userData.endpoint)];
                    if (c) { c.complete = false; c.stopReason = 'spending_limit'; }
                    throw new Error('Product spending allowance exhausted before the next page.');
                }
                await assertPublicNetworkTarget(new URL(request.url).origin);
                gotOptions.followRedirect = false;
            }],
            sessionPoolOptions: { maxPoolSize: 50, sessionOptions: { maxUsageCount: 30 } },
            failedRequestHandler: async (ctx) => {
                const { request } = ctx;
                retryPolicy.recordFailure(ctx);
                const c = stats.endpoints?.[String(request.userData.endpoint)];
                if (c) { c.complete = false; c.stopReason = stats.spendingLimitReached ? 'spending_limit' : 'failed'; }
                if (!stats.spendingLimitReached) stats.failedRequests++;
                log.warning('A Shopify page failed; its store history will not advance. No fallback proxy is used.');
            },
        });
        fatalStage = 'collection';
        await crawler.run(livePlans.map(({ origin, endpoint, single }) => ({
            url: pageUrl(endpoint, 1, pageSizeFor(maxProductsPerStore, productType), single),
            userData: { storeDomain: new URL(origin).host, origin, endpoint, single, page: 1, collected: 0 },
        })));
        fatalStage = undefined;
    } catch {
        log.error(`Shopify stopped at ${fatalStage ?? 'setup'}; history is withheld. Check input, permission, source access or saved history.`);
    }
}

if (monitor) {
    try {
        const report = await finalizeMonitoring(monitor, stats,
            (key, value, contentType) => Actor.setValue(key, key === 'RUN_SUMMARY' ? {
                ...(value as Record<string, unknown>), fatalStage: fatalStage ?? null,
                partial: !!fatalStage || !!(value as Record<string, unknown>).partial,
            } : value, contentType ? { contentType } : undefined), !!fatalStage);
        monitoringCommitFailed = report.stores.some((s) => s.historyStatus === 'commit_failed' || s.historyStatus === 'conflict');
        monitoringHistoryWithheld = report.stores.some((s) => s.historyStatus === 'withheld');
    } catch {
        fatalStage = 'report_export';
        // A confirmation export can fail after an earlier export and state write.
        // Do not promise a rollback across dataset/report/history services.
        await Actor.setValue('RUN_SUMMARY', { ...runSummary(stats), fatalStage,
            monitoring: { watchlistName, status: 'export_failed', historyStatus: 'check_private_store',
                warning: 'Reports were exported before history writes; a confirmation export may have failed after a commit.' } });
    }
} else {
    await Actor.setValue('RUN_SUMMARY', { ...runSummary(stats), fatalStage: fatalStage ?? null,
        monitoring: { requested: trackChanges, status: trackChanges ? 'no_live_history' : 'disabled' } });
}

if (fatalStage || monitoringCommitFailed) throw new Error(`Shopify run could not complete ${fatalStage ?? 'history confirmation'}; see RUN_SUMMARY.`);
if (stats.savedProducts === 0 && !stats.spendingLimitReached
    && !(stats.validResponses && stats.failedRequests === 0 && stats.skippedRequests === 0)) {
    throw new Error(`Shopify saved no products. Failed pages: ${stats.failedRequests}; skipped pages: ${stats.skippedRequests}.`);
}
await Actor.setStatusMessage(`${stats.spendingLimitReached ? 'Stopped at spending limit' : monitoringHistoryWithheld ? 'Finished partial; history withheld' : 'Finished'} with ${stats.savedProducts} Shopify products; ${stats.failedRequests} failed pages`);
await Actor.exit();
