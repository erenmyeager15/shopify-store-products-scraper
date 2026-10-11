import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const smokeRoot = resolve(repo, 'tmp', 'offline-smoke');

function runOffline(input, extraEnv = {}) {
    mkdirSync(smokeRoot, { recursive: true });
    const storage = mkdtempSync(join(smokeRoot, 'case-'));
    const store = join(storage, 'key_value_stores', 'default');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'INPUT.json'), JSON.stringify(input));
    const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^(APIFY_|ACTOR_|CRAWLEE_)/i.test(key)));
    const result = spawnSync(process.execPath,
        ['--import', './test/offline-guard.mjs', './dist/main.js'], {
            // SDK Actor.isAtHome checks string presence: unset/empty is local, not the literal "false".
            cwd: repo, env: { ...env, APIFY_IS_AT_HOME: '', APIFY_LOCAL_STORAGE_DIR: storage,
                APIFY_PURGE_ON_START: 'false', CRAWLEE_STORAGE_DIR: storage, CRAWLEE_PURGE_ON_START: 'false', ...extraEnv },
            timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024,
        });
    return { result, storage, store, summary: () => JSON.parse(readFileSync(join(store, 'RUN_SUMMARY.json'), 'utf8')) };
}

test('actual default Actor entry point produces labeled demo offline without history/proxy/source traffic', () => {
    const h = runOffline({ trackChanges: true, proxyConfiguration: { proxyUrls: ['http://dummy:do-not-leak@proxy.invalid:8000'] } });
    assert.equal(h.result.status, 0, h.result.stderr || h.result.stdout);
    assert.ok(!h.result.stdout.includes('blocked a network operation'));
    assert.ok(!h.result.stdout.includes('do-not-leak'));
    const summary = h.summary();
    assert.equal(summary.savedProducts, 1);
    assert.equal(summary.monitoring.status, 'no_live_history');
    assert.equal(summary.failedRequests, 0);
    assert.equal(readdirSync(join(h.storage, 'key_value_stores')).length, 1);
    const dataset = join(h.storage, 'datasets', 'default');
    const files = readdirSync(dataset).filter((name) => /^\d+\.json$/.test(name));
    assert.equal(files.length, 1);
    const row = JSON.parse(readFileSync(join(dataset, files[0]), 'utf8'));
    assert.equal(row.dataOrigin, 'bundled_demo');
    assert.equal(row.isDemo, true);
});

test('actual exhausted-allowance startup skips DNS, proxy and named history before any live setup', () => {
    // Local PPE testing uses $1/event. $0.50 permits zero product events, with no cloud billing.
    const h = runOffline({ storeUrls: ['example.com'], confirmAuthorizedUse: true, trackChanges: true,
        proxyConfiguration: { proxyUrls: ['http://dummy:do-not-leak@proxy.invalid:8000'] } }, {
            ACTOR_TEST_PAY_PER_EVENT: 'true', ACTOR_MAX_TOTAL_CHARGE_USD: '0.5',
        });
    assert.equal(h.result.status, 0, h.result.stderr || h.result.stdout);
    assert.ok(!h.result.stdout.includes('blocked a network operation'));
    assert.ok(!h.result.stdout.includes('do-not-leak'));
    const summary = h.summary();
    assert.equal(summary.savedProducts, 0);
    assert.equal(summary.spendingLimitReached, true);
    assert.equal(summary.failedRequests, 0);
    assert.equal(readdirSync(join(h.storage, 'key_value_stores')).length, 1);
    assert.equal(summary.endpoints['https://example.com/products.json'].successfulPages, 0);
});

test('a valid demo filter with zero matches is not reported as a source failure', () => {
    const h = runOffline({ productType: 'SHOES' });
    assert.equal(h.result.status, 0, h.result.stderr || h.result.stdout);
    assert.equal(h.summary().savedProducts, 0);
    assert.equal(h.summary().skippedRequests, 0);
    assert.equal(h.summary().failedRequests, 0);
    assert.equal(h.summary().validResponses, 1);
});
