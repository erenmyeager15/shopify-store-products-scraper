import { setTimeout as sleep } from 'node:timers/promises';
import type { RunStats } from './types.js';

export const MIN_RATE_LIMIT_DELAY_MS = 2000;
export const MAX_RATE_LIMIT_DELAY_MS = 15000;

// A long server cooldown is a stop, not permission to retry earlier than requested.
export function rateLimitDelay(header: unknown, now = Date.now()): number | null {
    const raw = Array.isArray(header) ? header[0] : header;
    let delay = MIN_RATE_LIMIT_DELAY_MS;
    if (typeof raw === 'string' && raw.trim()) {
        const text = raw.trim();
        if (/^\d+(?:\.\d+)?$/.test(text)) delay = Number(text) * 1000;
        else {
            const until = Date.parse(text);
            if (Number.isFinite(until)) delay = Math.max(0, until - now);
        }
    }
    if (!Number.isFinite(delay) || delay > MAX_RATE_LIMIT_DELAY_MS) return null;
    return Math.max(MIN_RATE_LIMIT_DELAY_MS, delay);
}

interface RetryRequest { retryCount: number; noRetry?: boolean }
interface RetryContext {
    request: RetryRequest;
    response?: { statusCode?: number; headers?: { 'retry-after'?: string | string[] } };
}

export function createRetryPolicy(stats: RunStats, canContinue: () => boolean,
    clock: { now: () => number; wait: (ms: number) => Promise<unknown> } = { now: Date.now, wait: sleep }) {
    const countedAttempts = new WeakMap<RetryRequest, number>();
    const stopped = new WeakSet<RetryRequest>();
    const recovered = new WeakSet<RetryRequest>();
    const countRateLimit = ({ request, response }: RetryContext) => {
        if (response?.statusCode !== 429 || countedAttempts.get(request) === request.retryCount) return;
        countedAttempts.set(request, request.retryCount);
        stats.rateLimitResponses = (stats.rateLimitResponses ?? 0) + 1;
    };
    const stopRateLimit = (request: RetryRequest) => {
        if (stopped.has(request)) return;
        stopped.add(request);
        stats.rateLimitStops = (stats.rateLimitStops ?? 0) + 1;
    };
    const stopAtBudget = (request: RetryRequest) => {
        request.noRetry = true;
        stats.spendingLimitReached = true;
    };
    return {
        async beforeRetry(ctx: RetryContext): Promise<void> {
            const { request, response } = ctx;
            countRateLimit(ctx);
            // Respect access denial; rotating credentials/proxies is not a fallback.
            if (response?.statusCode === 401 || response?.statusCode === 403 || request.noRetry) {
                request.noRetry = true;
                return;
            }
            if (!canContinue()) { stopAtBudget(request); return; }
            if (response?.statusCode === 429) {
                const delay = rateLimitDelay(response.headers?.['retry-after'], clock.now());
                if (delay === null) { request.noRetry = true; stopRateLimit(request); return; }
                await clock.wait(delay);
                if (!canContinue()) { stopAtBudget(request); return; }
            }
            stats.retryAttempts = (stats.retryAttempts ?? 0) + 1;
        },
        recordRecovered(request: RetryRequest): void {
            if (request.retryCount < 1 || recovered.has(request)) return;
            recovered.add(request);
            stats.recoveredRequests = (stats.recoveredRequests ?? 0) + 1;
        },
        recordFailure(ctx: RetryContext): void {
            countRateLimit(ctx);
            if (ctx.response?.statusCode === 429) stopRateLimit(ctx.request);
        },
    };
}
