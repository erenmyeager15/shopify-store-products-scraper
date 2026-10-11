import assert from 'node:assert/strict';
import test from 'node:test';
import { rateLimitDelay, createRetryPolicy } from '../dist/retry-policy.js';
import { HttpCrawler } from '@crawlee/http';

function harness(allow = () => true) {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const waits = [];
    const policy = createRetryPolicy(stats, allow, { now: () => Date.parse('2026-10-11T00:00:00Z'), wait: async ms => waits.push(ms) });
    return { stats, waits, policy };
}
const context = (statusCode, header, retryCount = 0) => ({ request: { retryCount },
    response: { statusCode, headers: { 'retry-after': header } } });

test('missing/malformed/zero cooldowns use a small nonzero backoff', () => {
    for (const header of [undefined, '', 'invalid', '-3', '0', '0.5']) assert.equal(rateLimitDelay(header), 2000);
    assert.equal(rateLimitDelay('4'), 4000);
    assert.equal(rateLimitDelay(['3', '8']), 3000);
});
test('server dates are respected and long cooldowns stop instead of being clamped early', () => {
    const now = Date.parse('2026-10-11T00:00:00Z');
    assert.equal(rateLimitDelay('Sun, 11 Oct 2026 00:00:07 GMT', now), 7000);
    assert.equal(rateLimitDelay('Sun, 11 Oct 2026 00:00:17 GMT', now), null);
    assert.equal(rateLimitDelay('15'), 15000);
    assert.equal(rateLimitDelay('16'), null);
    assert.equal(rateLimitDelay('9'.repeat(400)), null);
});
test('429 retry waits once and exposes the recovery without double-counting', async () => {
    const h = harness(); const ctx = context(429, '3');
    await h.policy.beforeRetry(ctx);
    assert.deepEqual(h.waits, [3000]);
    assert.equal(h.stats.rateLimitResponses, 1);
    assert.equal(h.stats.retryAttempts, 1);
    ctx.request.retryCount++;
    h.policy.recordRecovered(ctx.request); h.policy.recordRecovered(ctx.request);
    assert.equal(h.stats.recoveredRequests, 1);
    assert.equal(h.stats.failedRequests, 0);
});
test('a terminal second 429 is counted separately, without another retry', async () => {
    const h = harness(); const ctx = context(429);
    await h.policy.beforeRetry(ctx); ctx.request.retryCount++;
    h.policy.recordFailure(ctx); h.policy.recordFailure(ctx);
    assert.equal(h.stats.rateLimitResponses, 2);
    assert.equal(h.stats.retryAttempts, 1);
    assert.equal(h.stats.rateLimitStops, 1);
    assert.deepEqual(h.waits, [2000]);
});
test('long cooldown cancels the retry and failure accounting is idempotent', async () => {
    const h = harness(); const ctx = context(429, '60');
    await h.policy.beforeRetry(ctx); h.policy.recordFailure(ctx);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(h.stats.retryAttempts, undefined);
    assert.equal(h.stats.rateLimitResponses, 1);
    assert.equal(h.stats.rateLimitStops, 1);
    assert.deepEqual(h.waits, []);
});
test('access-denied responses are not retried', async () => {
    for (const code of [401, 403]) {
        const h = harness(); const ctx = context(code);
        await h.policy.beforeRetry(ctx);
        assert.equal(ctx.request.noRetry, true);
        assert.equal(h.stats.retryAttempts, undefined);
        assert.deepEqual(h.waits, []);
    }
});
test('exhausted product allowance stops before waiting or retrying', async () => {
    const h = harness(() => false); const ctx = context(429, '4');
    await h.policy.beforeRetry(ctx);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(h.stats.spendingLimitReached, true);
    assert.equal(h.stats.retryAttempts, undefined);
    assert.deepEqual(h.waits, []);
});
test('allowance lost during backoff cancels the source retry', async () => {
    let checks = 0;
    const h = harness(() => ++checks === 1); const ctx = context(429, '4');
    await h.policy.beforeRetry(ctx);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(h.stats.spendingLimitReached, true);
    assert.equal(h.stats.retryAttempts, undefined);
    assert.deepEqual(h.waits, [4000]);
});
test('existing non-retryable delivery failure stays non-retryable', async () => {
    const h = harness(); const ctx = { request: { retryCount: 0, noRetry: true } };
    await h.policy.beforeRetry(ctx);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(h.stats.retryAttempts, undefined);
    assert.deepEqual(h.waits, []);
});
test('non-throttling retry is reported without inventing a rate-limit or recovery', async () => {
    const h = harness(); const ctx = context(503);
    await h.policy.beforeRetry(ctx);
    h.policy.recordRecovered(ctx.request);
    assert.equal(h.stats.retryAttempts, 1);
    assert.equal(h.stats.rateLimitResponses, undefined);
    assert.equal(h.stats.recoveredRequests, undefined);
    assert.deepEqual(h.waits, []);
});

// Exercise the installed crawler's real retry dispatch, with storage/traffic mocked out.
function crawlerHarness(policy) {
    const dispatched = { retries: 0, failures: 0 };
    const crawler = {
        maxRequestRetries: 1, maxSessionRotations: 1,
        _canRequestBeRetried: HttpCrawler.prototype._canRequestBeRetried,
        _tagUserHandlerError: async cb => cb(), _getMessageFromError: error => error.message,
        _augmentContextWithDeprecatedError: ctx => ctx, _rotateSession: async () => {},
        _handleFailedRequestHandler: async ctx => policy.recordFailure(ctx),
        errorHandler: ctx => policy.beforeRetry(ctx), log: { warning: () => {} },
        stats: { errorTrackerRetry: { addAsync: async () => {} }, errorTracker: { add: () => {}, addAsync: async () => {} },
            failJob: () => dispatched.failures++ },
    };
    const source = { reclaimRequest: async () => dispatched.retries++, markRequestHandled: async () => {} };
    const error = (ctx) => HttpCrawler.prototype._requestFunctionErrorHandler.call(crawler, new Error('HTTP response failed'), ctx, source);
    return { dispatched, error };
}
test('installed crawler permits only one throttled retry and records the terminal second response', async () => {
    const h = harness(); const c = crawlerHarness(h.policy); const ctx = context(429, '3');
    ctx.request.pushErrorMessage = () => {};
    await c.error(ctx);
    assert.equal(ctx.request.retryCount, 1);
    assert.equal(c.dispatched.retries, 1);
    await c.error(ctx);
    assert.equal(c.dispatched.retries, 1);
    assert.equal(c.dispatched.failures, 1);
    assert.equal(h.stats.rateLimitResponses, 2);
    assert.deepEqual(h.waits, [3000]);
});
test('installed crawler honors a long cooldown stop without dispatching a retry', async () => {
    const h = harness(); const c = crawlerHarness(h.policy); const ctx = context(429, '60');
    ctx.request.pushErrorMessage = () => {};
    await c.error(ctx);
    assert.equal(ctx.request.retryCount, 0);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(c.dispatched.retries, 0);
    assert.equal(c.dispatched.failures, 1);
    assert.equal(h.stats.rateLimitResponses, 1);
    assert.equal(h.stats.rateLimitStops, 1);
    assert.deepEqual(h.waits, []);
});
