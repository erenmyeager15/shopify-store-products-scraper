import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from '../dist/input.js';
import { buildRouter, mapProduct } from '../dist/routes.js';
import { planStoreRequest } from '../dist/request-plan.js';
import { ShopifyMonitor, monitorScopes, validateState, watchlistStoreName, MAX_STATE_BYTES, withCurrency } from '../dist/monitoring.js';
import { finalizeMonitoring, csvCell, changesCsv, reportMarkdown, runSummary } from '../dist/reporting.js';
import { normalizeStoreOrigin } from '../dist/url-safety.js';
import { createOfficialDemoRecord } from '../dist/demo-fixture.js';

const origin = 'https://example.com';
const endpoint = `${origin}/products.json`;
const t1 = '2026-10-11T00:00:00.000Z', t2 = '2026-10-12T00:00:00.000Z';
const product = { id: 1, title: 'US merchant sample', vendor: 'Sample', handle: 'sample', product_type: 'Shoes',
    variants: [{ id: 101, price: '10', compare_at_price: '15', available: true, sku: 'shoe-a' },
        { id: 102, price: '20', compare_at_price: null, available: false, sku: 'shoe-b' }], images: [] };
const row = (overrides = {}, at = t1) => ({ ...mapProduct({ ...product, ...overrides }, origin, 'example.com', 1), scrapedAt: at });
const options = (overrides = {}) => normalizeInput({ storeUrls: ['example.com'], maxProductsPerStore: 25,
    confirmAuthorizedUse: true, trackChanges: true, storeCurrency: 'USD', ...overrides });
const scopeFor = (input) => monitorScopes(input.storeUrls.map(planStoreRequest), input);
const statsFor = (reason = 'exhausted', overrides = {}) => ({ savedProducts: 1, failedRequests: 0, skippedRequests: 0,
    endpoints: { [endpoint]: { origin, successfulPages: 1, complete: reason === 'exhausted', stopReason: reason, invalidProducts: 0 } }, ...overrides });

function memoryStore() {
    const values = new Map(), writes = [];
    return { values, writes, getValue: async (key) => structuredClone(values.get(key) ?? null),
        setValue: async (key, value) => { writes.push(key); values.set(key, structuredClone(value)); } };
}
const load = (store, input = options()) => ShopifyMonitor.load(scopeFor(input), store, input);
async function baseline(store, input = options(), products = [row()], stats = statsFor()) {
    const m = await load(store, input);
    for (const r of products) m.saved(m.prepare(r));
    return finalizeMonitoring(m, stats, async () => {});
}

test('monitoring is optional; default input keeps the tiny no-proxy catalog demo', () => {
    const input = normalizeInput();
    assert.equal(input.trackChanges, false);
    assert.equal(input.maxProductsPerStore, 1);
    assert.equal(input.proxyConfiguration, undefined);
    assert.equal(input.storeCurrency, '');
    assert.equal(input.maxHistoryPoints, 10);
});

test('validates monitor inputs without accepting path names or malformed currency', () => {
    for (const watchlistName of ['../state', '', 'x'.repeat(81), 'spaces not allowed']) {
        if (watchlistName) assert.throws(() => options({ watchlistName }), /watchlistName/);
    }
    for (const raw of [{ trackChanges: 'true' }, { maxHistoryPoints: 31 }, { storeCurrency: 'US$' }])
        assert.throws(() => options(raw));
    assert.equal(options({ storeCurrency: ' usd ' }).storeCurrency, 'USD');
    assert.match(watchlistStoreName('shopify-us-watchlist'), /^shopify-watchlist-v1-[a-f0-9]{24}$/);
    assert.notEqual(watchlistStoreName('a'), watchlistStoreName('b'));
});

test('scope keys isolate stores, collections, filters, limits and currency', () => {
    const input = options();
    const k = scopeFor(input)[0].key;
    for (const change of [{ storeUrls: ['example.com/collections/shoes'] }, { productType: 'Shoes' },
        { maxProductsPerStore: 50 }, { storeCurrency: 'EUR' }, { storeUrls: ['other.example'] }])
        assert.notEqual(scopeFor(options(change))[0].key, k);
    const a = options({ storeUrls: ['example.com/collections/a', 'example.com/collections/b'] });
    const b = options({ storeUrls: [...a.storeUrls].reverse() });
    assert.equal(scopeFor(a)[0].key, scopeFor(b)[0].key);
    assert.equal(scopeFor(options({ productType: 'SHOES' }))[0].key, scopeFor(options({ productType: 'shoes' }))[0].key);
});

test('baseline then identical repeat retains first observation and increments count', async () => {
    const store = memoryStore();
    const m1 = await load(store);
    const first = m1.prepare(row());
    assert.equal(first.monitoringStatus, 'baseline');
    m1.saved(first);
    const initial = await finalizeMonitoring(m1, statsFor(), async () => {});
    assert.equal(initial.stores[0].historyStatus, 'committed');
    assert.equal(initial.changes.length, 0);
    const m2 = await load(store), next = m2.prepare(row({}, t2));
    assert.equal(next.monitoringStatus, 'unchanged');
    assert.equal(next.firstObservedAt, t1);
    assert.equal(next.observationCount, 2);
    assert.equal(next.historyPoints, 2);
    assert.equal(next.currency, 'USD');
    assert.equal(next.currencySource, 'user_declared');
    m2.saved(next);
    const report = await finalizeMonitoring(m2, statsFor(), async () => {});
    assert.equal(report.stores[0].unchangedProducts, 1);
    assert.equal(report.stores[0].historyStatus, 'committed');
});

test('same-ID variant price drop is found even when minimum product price is unchanged', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const updated = m.prepare(row({ variants: [product.variants[0], { ...product.variants[1], price: '18' }] }, t2));
    assert.equal(updated.price, 10);
    assert.equal(updated.priceChange, 0);
    assert.equal(updated.monitoringStatus, 'changed');
    assert.deepEqual(updated.variantChanges[0].changes, ['price_drop']);
    assert.equal(updated.variantChanges[0].variantId, 102);
    assert.equal(updated.variantChanges[0].priceChange, -2);
    assert.equal(updated.variantChanges[0].priceChangePercent, -10);
});

test('product minimum price deltas and retained-window min/max are explicit', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const updated = m.prepare(row({ variants: [{ ...product.variants[0], price: '8' }, product.variants[1]] }, t2));
    assert.ok(updated.changes.includes('price_drop'));
    assert.equal(updated.previousPrice, 10);
    assert.equal(updated.priceChange, -2);
    assert.equal(updated.priceChangePercent, -20);
    assert.equal(updated.minObservedPrice, 8);
    assert.equal(updated.maxObservedPrice, 10);
    assert.equal(updated.priceComparisonBasis, 'user_declared_same_currency');
});

test('unknown currency reports numeric changes without verified price alerts or percentages', async () => {
    const store = memoryStore(), input = options({ storeCurrency: '' });
    await baseline(store, input);
    const m = await load(store, input);
    const updated = m.prepare(row({ variants: [{ ...product.variants[0], price: '8' }] }, t2));
    assert.equal(updated.currency, 'N/A');
    assert.ok(updated.changes.includes('price_value_changed'));
    assert.ok(!updated.changes.includes('price_drop'));
    assert.equal(updated.priceChange, null);
    assert.equal(updated.priceChangePercent, null);
    assert.equal(updated.variantChanges[0].priceChangePercent, null);
    assert.equal(updated.priceComparisonBasis, 'unverified_currency');
    assert.ok(updated.dataQualityWarnings.some((w) => w.includes('currency_not_verified')));
});

test('unknown availability does not become sold-out or restocked', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const unknown = m.prepare(row({ variants: product.variants.map(({ available, ...v }) => v) }, t2));
    assert.equal(unknown.inStock, null);
    assert.ok(!unknown.changes.includes('sold_out'));
    assert.ok(!unknown.changes.includes('restocked'));
    assert.ok(unknown.variantChanges.every((v) => !v.changes.includes('sold_out') && !v.changes.includes('restocked')));
    assert.ok(unknown.dataQualityWarnings.includes('availability_not_exposed'));
});

test('known variant restock is found when overall product stock stays true', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const update = m.prepare(row({ variants: [product.variants[0], { ...product.variants[1], available: true }] }, t2));
    assert.equal(update.inStock, true);
    assert.ok(update.variantChanges[0].changes.includes('restocked'));
    assert.ok(!update.changes.includes('restocked'));
});

test('sale changes compare prices from the same stable variant', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const update = m.prepare(row({ variants: [{ ...product.variants[0], compare_at_price: null },
        { ...product.variants[1], compare_at_price: '25' }] }, t2));
    assert.ok(update.variantChanges.find((v) => v.variantId === 101).changes.includes('sale_ended'));
    assert.ok(update.variantChanges.find((v) => v.variantId === 102).changes.includes('sale_started'));
});

test('SKU equality does not fuzzily match different variant IDs', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const update = m.prepare(row({ variants: [{ ...product.variants[0], id: 103 }, product.variants[1]] }, t2));
    assert.equal(update.variantChanges.length, 2);
    assert.ok(update.variantChanges.find((v) => v.variantId === 101).changes.includes('variant_not_seen'));
    assert.ok(update.variantChanges.find((v) => v.variantId === 103).changes.includes('variant_newly_observed'));
    assert.ok(update.variantChanges.every((v) => v.priceChange === null));
});

test('missing/duplicate variant IDs are excluded from matching with a warning', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const update = m.prepare(row({ variants: [{ ...product.variants[0] }, { ...product.variants[1], id: 101 }] }, t2));
    assert.ok(update.dataQualityWarnings.some((w) => w.includes('duplicate_ids')));
    assert.equal(update.variantChanges.length, 0);
});

test('zero previous price never produces infinity or invented percentage', async () => {
    const store = memoryStore(); await baseline(store, options(), [row({ variants: [{ ...product.variants[0], price: '0' }] })]);
    const update = (await load(store)).prepare(row({}, t2));
    assert.equal(update.priceChange, 10);
    assert.equal(update.priceChangePercent, null);
});

test('capped scans merge observations but never infer missing products', async () => {
    const store = memoryStore(); await baseline(store, options(), [row(), row({ id: 2, handle: 'second' })]);
    const m = await load(store); m.saved(m.prepare(row({}, t2)));
    const report = await finalizeMonitoring(m, statsFor('product_limit'), async () => {});
    assert.equal(report.stores[0].historyStatus, 'committed');
    assert.equal(report.stores[0].scopeComplete, false);
    assert.equal(report.stores[0].notSeenProducts, 0);
    assert.equal(report.changes.length, 0);
    const state = store.values.get(scopeFor(options())[0].key);
    assert.equal(Object.keys(state.products).length, 2);
    assert.equal(state.complete, false);
});

test('newly observed on partial history does not claim a product launch', async () => {
    const store = memoryStore(); await baseline(store, options(), [row()], statsFor('product_limit'));
    const next = (await load(store)).prepare(row({ id: 2, handle: 'second' }, t2));
    assert.equal(next.monitoringStatus, 'newly_observed');
    assert.ok(next.dataQualityWarnings.some((w) => w.includes('does_not_mean_new_product_launch')));
});

test('not-seen signals require two complete scans and do not assert deletion or stock', async () => {
    const store = memoryStore(); await baseline(store);
    const m = await load(store);
    const report = await finalizeMonitoring(m, statsFor('exhausted', { savedProducts: 0 }), async () => {});
    assert.equal(report.stores[0].notSeenProducts, 1);
    assert.equal(report.changes[0].status, 'not_seen_in_complete_scope');
    assert.equal(report.changes[0].inStock, null);
    assert.equal(report.changes[0].priceChange, null);
    const s2 = memoryStore(); await baseline(s2, options(), [row()], statsFor('product_limit'));
    const empty = await finalizeMonitoring(await load(s2), statsFor(), async () => {});
    assert.equal(empty.changes.length, 0);
});

test('failed, skipped, repeated and invalid pages leave previous history untouched', async () => {
    for (const reason of ['failed', 'skipped', 'repeated_page', 'page_limit', 'pending']) {
        const store = memoryStore(); await baseline(store);
        const key = scopeFor(options())[0].key, previous = structuredClone(store.values.get(key));
        const m = await load(store); m.saved(m.prepare(row({}, t2)));
        const report = await finalizeMonitoring(m, statsFor(reason), async () => {});
        assert.equal(report.stores[0].historyStatus, 'withheld');
        assert.deepEqual(store.values.get(key), previous);
    }
    const store = memoryStore(), m = await load(store); m.saved(m.prepare(row()));
    const stats = statsFor(); stats.endpoints[endpoint].invalidProducts = 1;
    assert.equal((await finalizeMonitoring(m, stats, async () => {})).stores[0].historyStatus, 'withheld');
    assert.equal(store.writes.length, 0);
});

test('spending stops and unexpected run failure never advance saved history', async () => {
    for (const [stats, failed] of [[statsFor('exhausted', { spendingLimitReached: true }), false], [statsFor(), true]]) {
        const store = memoryStore(), m = await load(store); m.saved(m.prepare(row()));
        const report = await finalizeMonitoring(m, stats, async () => {}, failed);
        assert.equal(report.stores[0].historyStatus, 'withheld');
        assert.equal(store.writes.length, 0);
    }
});

test('preparing an undelivered row does not advance history', async () => {
    const store = memoryStore(), m = await load(store);
    m.prepare(row());
    const report = await finalizeMonitoring(m, statsFor('product_limit'), async () => {});
    assert.equal(report.stores[0].observedProducts, 0);
    assert.equal(report.stores[0].historyStatus, 'no_observations');
    assert.equal(store.writes.length, 0);
});

test('exports precede history; failure at any first export leaves history unchanged', async () => {
    for (const failAt of ['MONITORING-REPORT', 'CHANGES.csv', 'MONITORING-REPORT.md', 'RUN_SUMMARY']) {
        const store = memoryStore(), m = await load(store); m.saved(m.prepare(row()));
        await assert.rejects(finalizeMonitoring(m, statsFor(), async (key) => {
            assert.equal(store.writes.length, 0);
            if (key === failAt) throw new Error('fixture export failure');
        }));
        assert.equal(store.writes.length, 0);
    }
});

test('confirmed reports expose final commit outcome; no extra product billing', async () => {
    const store = memoryStore(), m = await load(store), calls = []; m.saved(m.prepare(row()));
    await finalizeMonitoring(m, statsFor(), async (key, value, type) => calls.push({ key, value: structuredClone(value), type }));
    assert.equal(calls.length, 8);
    assert.equal(calls[0].value.stores[0].historyStatus, 'pending');
    assert.equal(calls[4].value.stores[0].historyStatus, 'committed');
    assert.equal(calls[1].type, 'text/csv; charset=utf-8');
    assert.equal(calls[7].value.monitoring.stores[0].historyStatus, 'committed');
});

test('confirmation export failure is explicit and does not falsely promise rollback', async () => {
    const store = memoryStore(), m = await load(store); m.saved(m.prepare(row()));
    let n = 0;
    await assert.rejects(finalizeMonitoring(m, statsFor(), async () => { if (++n === 5) throw new Error('confirmation failed'); }));
    assert.equal(store.writes.length, 1);
});

test('revision conflict is detected without overwriting another run', async () => {
    const store = memoryStore(); await baseline(store);
    const a = await load(store), b = await load(store); a.saved(a.prepare(row({}, t2))); b.saved(b.prepare(row({}, t2)));
    await finalizeMonitoring(a, statsFor(), async () => {});
    const before = structuredClone(store.values.get(scopeFor(options())[0].key));
    const report = await finalizeMonitoring(b, statsFor(), async () => {});
    assert.equal(report.stores[0].historyStatus, 'conflict');
    assert.deepEqual(store.values.get(scopeFor(options())[0].key), before);
});

test('state-write failure is reported without pretending history was committed', async () => {
    const store = memoryStore(), m = await load(store); m.saved(m.prepare(row()));
    store.setValue = async () => { throw new Error('secret transport detail'); };
    const report = await finalizeMonitoring(m, statsFor(), async () => {});
    assert.equal(report.stores[0].historyStatus, 'commit_failed');
    assert.ok(!JSON.stringify(report).includes('secret transport'));
});

test('history retains the configured recent window, not unbounded full catalog rows', async () => {
    const store = memoryStore(), input = options({ maxHistoryPoints: 2 });
    for (let day = 11; day <= 14; day++) await baseline(store, input, [row({}, `2026-10-${day}T00:00:00.000Z`)]);
    const state = store.values.get(scopeFor(input)[0].key), p = state.products['1'];
    assert.equal(p.history.length, 2);
    assert.equal(p.firstObservedAt, t1);
    assert.equal(p.observationCount, 4);
    assert.equal(p.description, undefined);
    assert.equal(p.images, undefined);
    assert.equal(p.history[0].at, '2026-10-13T00:00:00.000Z');
});

test('corrupt or oversized private history fails explicitly rather than resetting baseline', async () => {
    const input = options(), scope = scopeFor(input)[0], store = memoryStore(); await baseline(store);
    const valid = store.values.get(scope.key);
    for (const mutate of [(v) => { v.version = 2; }, (v) => { v.scopeKey = 'wrong'; },
        (v) => { v.products['1'].history[0].price = -1; }, (v) => { v.products['1'].url = 'https://other.example/products/x'; },
        (v) => { v.products['1'].variants.push(v.products['1'].variants[0]); },
        (v) => { v.products['1'].id = 'wrong'; }, (v) => { v.large = 'x'.repeat(MAX_STATE_BYTES); }]) {
        const raw = structuredClone(valid); mutate(raw);
        assert.throws(() => validateState(raw, scope), /invalid or oversized/);
        store.values.set(scope.key, raw);
        await assert.rejects(load(store), /History was not reset/);
    }
    assert.equal(store.writes.length, 1);
});

test('candidate history size cap withholds history while preserving reports', async () => {
    const store = memoryStore(), m = await load(store);
    const variants = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, sku: 'x'.repeat(256), price: '10', available: true }));
    for (let id = 1; id <= 12; id++) m.saved(m.prepare(row({ id, handle: `p-${id}`, variants })));
    const report = await finalizeMonitoring(m, statsFor('product_limit'), async () => {});
    assert.equal(report.stores[0].historyStatus, 'withheld');
    assert.ok(report.stores[0].warnings.some((w) => w.includes('4 MiB')));
    assert.equal(store.writes.length, 0);
});

test('demo output never advances live watchlist history', async () => {
    const store = memoryStore(), m = await load(store);
    const demo = createOfficialDemoRecord(); m.saved(m.prepare(demo));
    const report = await finalizeMonitoring(m, statsFor('product_limit'), async () => {});
    assert.equal(report.stores[0].observedProducts, 0);
    assert.equal(store.writes.length, 0);
});

test('CSV output quotes values and neutralizes spreadsheet formulas', () => {
    for (const text of ['=HYPERLINK("bad")', '+cmd', '-cmd', '@SUM(A1)', '  =SUM(A1)', '\tformula', '\nformula', '\uFEFF=evil'])
        assert.ok(csvCell(text).startsWith('"\''));
    assert.equal(csvCell('a"b,c\nd'), '"a""b,c\nd"');
    assert.equal(csvCell(null), '""');
    const report = { changes: [{ title: '=bad', productId: '1', changes: ['price_drop'] }] };
    assert.match(changesCsv(report), /"'\=bad"/);
});

test('markdown report does not embed source-controlled scripts or links', () => {
    const report = { watchlistName: 'safe', generatedAt: t1, currencyBasis: 'unknown', stores: [{ store: '<img onerror=bad>',
        observedProducts: 1, changedProducts: 1, newlyObservedProducts: 0, notSeenProducts: 0, scopeComplete: false,
        historyStatus: 'withheld', warnings: ['[bad](javascript:alert(1))'] }], notes: [] };
    const md = reportMarkdown(report);
    assert.ok(md.includes('\\<img'));
    assert.ok(md.includes('\\[bad\\]\\(javascript:alert\\(1\\)\\)'));
});

test('router checks current spending allowance before every delivered row', async () => {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 }, records = [];
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats, canContinue: () => records.length < 1,
        pushData: async (r) => { records.push(r); return { chargedCount: 1, eventChargeLimitReached: false }; }, setStatus: async () => {} });
    await router(context([product, { ...product, id: 2 }]));
    assert.equal(records.length, 1);
    assert.equal(stats.savedProducts, 1);
    assert.equal(stats.spendingLimitReached, true);
});

function context(products, overrides = {}) {
    return { body: Buffer.from(JSON.stringify({ products })), request: { userData: { origin, endpoint, storeDomain: 'example.com',
        page: 1, collected: 0, single: false, ...overrides } },
        crawler: { addRequests: async () => {}, autoscaledPool: { abort: async () => {} } } };
}

test('zero allowance prevents payload parsing and any dataset/history delivery', async () => {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats, canContinue: () => false,
        pushData: async () => assert.fail('must not push'), recordSaved: () => assert.fail('must not save'), setStatus: async () => {} });
    const ctx = context([]); ctx.body = Buffer.from('malformed'); await router(ctx);
    assert.equal(stats.spendingLimitReached, true);
});

test('dataset persistence failure disables source retry and does not stage history', async () => {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 }, ctx = context([product]);
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats,
        pushData: async () => { throw new Error('proxy password'); }, recordSaved: () => assert.fail('must not save') });
    await assert.rejects(router(ctx), /persistence failed/);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(stats.endpoints[endpoint].stopReason, 'failed');
    assert.equal(stats.savedProducts, 0);
});

test('rejected charge never calls the history saved hook', async () => {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats,
        pushData: async () => ({ chargedCount: 0, eventChargeLimitReached: true }),
        recordSaved: () => assert.fail('must not advance history'), setStatus: async () => {} });
    await router(context([product]));
    assert.equal(stats.savedProducts, 0);
});

test('cap reached in another endpoint cannot create a false complete-scope result', async () => {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats,
        pushData: async () => ({ chargedCount: 1, eventChargeLimitReached: false }) });
    await router(context([product, { ...product, id: 2 }, { ...product, id: 3 }]));
    const next = `${origin}/collections/other/products.json`;
    await router(context([{ ...product, id: 4 }], { endpoint: next }));
    assert.equal(stats.endpoints[next].complete, false);
    assert.equal(stats.endpoints[next].stopReason, 'product_limit');
});

test('invalid product identity cannot be billed or used as stable history', () => {
    for (const id of [{ bad: 'id' }, [], Number.MAX_SAFE_INTEGER + 1, '', 'nan', -1, 0])
        assert.equal(row({ id }).productId, null);
    assert.equal(row({ id: '12345678901234567890' }).productId, '12345678901234567890');
});

test('safe errors do not echo credential-bearing or malformed URLs', () => {
    for (const url of ['https://user:supersecret@example.com', 'https://user:supersecret@%bad']) {
        try { normalizeStoreOrigin(url); assert.fail('must reject'); }
        catch (error) { assert.ok(!String(error).includes('supersecret')); }
    }
});

test('summary distinguishes configured cap from source failures and budget truncation', () => {
    assert.equal(runSummary(statsFor('product_limit')).boundedScan, true);
    assert.equal(runSummary(statsFor('product_limit')).scopeComplete, false);
    assert.equal(runSummary(statsFor('exhausted')).scopeComplete, true);
    assert.equal(runSummary(statsFor('exhausted', { spendingLimitReached: true })).partial, true);
});

test('currency annotation without monitoring does not invent a verified source', () => {
    assert.equal(withCurrency(row(), '').currency, 'N/A');
    assert.equal(withCurrency(row(), '').currencySource, 'not_exposed');
    assert.equal(withCurrency(row(), 'USD').currencySource, 'user_declared');
});

test('negative numeric CSV deltas remain numeric while source strings stay protected', () => {
    assert.equal(csvCell(-2), '"-2"');
    assert.equal(csvCell('-2+cmd'), '"\'-2+cmd"');
});

test('price arithmetic stays finite for extreme source values', async () => {
    const store = memoryStore(); await baseline(store);
    const update = (await load(store)).prepare(row({ variants: [{ ...product.variants[0], price: '1' + '0'.repeat(300) }] }, t2));
    assert.ok(Number.isFinite(update.priceChange));
    assert.ok(update.priceChangePercent === null || Number.isFinite(update.priceChangePercent));
});

test('history staging failure after delivery cannot trigger duplicate source retry', async () => {
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 }, ctx = context([product]);
    const router = buildRouter({ maxProductsPerStore: 3, productType: '', stats,
        pushData: async () => ({ chargedCount: 1, eventChargeLimitReached: false }),
        recordSaved: () => { throw new Error('synthetic staging failure'); } });
    await assert.rejects(router(ctx), /delivered, but monitoring staging failed/);
    assert.equal(ctx.request.noRetry, true);
    assert.equal(stats.savedProducts, 1);
    assert.equal(stats.endpoints[endpoint].stopReason, 'failed');
});

test('upper-case type input still matches live products and monitoring scope', async () => {
    const input = options({ productType: 'SHOES' });
    assert.equal(input.productType, 'shoes');
    const stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const router = buildRouter({ maxProductsPerStore: 25, productType: input.productType, stats,
        pushData: async () => ({ chargedCount: 1, eventChargeLimitReached: false }) });
    await router(context([product]));
    assert.equal(stats.savedProducts, 1);
});

test('full router -> delivered monitoring -> exports -> repeat preserves one charge per product', async () => {
    const store = memoryStore(); let chargeCalls = 0;
    for (const at of [t1, t2]) {
        const monitor = await load(store), stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
        const router = buildRouter({ maxProductsPerStore: 25, productType: '', stats,
            prepareRecord: (r) => monitor.prepare({ ...r, scrapedAt: at }), recordSaved: (r) => monitor.saved(r),
            pushData: async (_r, event) => { assert.equal(event, 'product-scraped'); chargeCalls++; return { chargedCount: 1, eventChargeLimitReached: false }; } });
        await router(context([product]));
        const report = await finalizeMonitoring(monitor, stats, async () => {});
        assert.equal(report.stores[0].historyStatus, 'committed');
        assert.equal(report.stores[0].scopeComplete, true);
        assert.equal(report.stores[0].unchangedProducts, at === t2 ? 1 : 0);
    }
    assert.equal(chargeCalls, 2);
    assert.equal(store.values.get(scopeFor(options())[0].key).products['1'].observationCount, 2);
});

test('later page failure withholds history despite earlier paid delivery', async () => {
    const store = memoryStore(); await baseline(store);
    const monitor = await load(store), stats = { savedProducts: 0, failedRequests: 0, skippedRequests: 0 };
    const router = buildRouter({ maxProductsPerStore: 25, productType: '', stats,
        prepareRecord: (r) => monitor.prepare(r), recordSaved: (r) => monitor.saved(r),
        pushData: async () => ({ chargedCount: 1, eventChargeLimitReached: false }) });
    await router(context([product]));
    stats.endpoints[endpoint].complete = false;
    stats.endpoints[endpoint].stopReason = 'failed'; stats.failedRequests++;
    const previous = structuredClone(store.values.get(scopeFor(options())[0].key));
    const report = await finalizeMonitoring(monitor, stats, async () => {});
    assert.equal(report.stores[0].historyStatus, 'withheld');
    assert.deepEqual(store.values.get(scopeFor(options())[0].key), previous);
    assert.equal(stats.savedProducts, 1);
});

test('one store failure does not advance it or suppress a safe independent store', async () => {
    const input = options({ storeUrls: ['example.com', 'other.example'] }), store = memoryStore();
    const monitor = await load(store, input);
    monitor.saved(monitor.prepare(row()));
    monitor.saved(monitor.prepare({ ...row(), productUrl: 'https://other.example/products/sample', searchQuery: 'other.example' }));
    const stats = statsFor('failed', { savedProducts: 2, failedRequests: 1 });
    stats.endpoints['https://other.example/products.json'] = { origin: 'https://other.example', successfulPages: 1,
        complete: true, stopReason: 'exhausted', invalidProducts: 0 };
    const report = await finalizeMonitoring(monitor, stats, async () => {});
    assert.equal(report.stores.find((s) => s.store === 'example.com').historyStatus, 'withheld');
    assert.equal(report.stores.find((s) => s.store === 'other.example').historyStatus, 'committed');
    assert.equal(store.values.size, 1);
});

test('source variant order alone does not create false changes', async () => {
    const store = memoryStore(); await baseline(store);
    const update = (await load(store)).prepare(row({ variants: [...product.variants].reverse() }, t2));
    assert.equal(update.monitoringStatus, 'unchanged');
});

test('partial history retention stays bounded when the observed catalog grows', async () => {
    const store = memoryStore();
    await baseline(store, options(), Array.from({ length: 1000 }, (_, i) => row({ id: i + 1, handle: `p-${i + 1}` })), statsFor('product_limit'));
    const monitor = await load(store); monitor.saved(monitor.prepare(row({ id: 1001, handle: 'p-1001' }, t2)));
    const report = await finalizeMonitoring(monitor, statsFor('product_limit'), async () => {});
    const state = store.values.get(scopeFor(options())[0].key);
    assert.equal(Object.keys(state.products).length, 1000);
    assert.equal(state.complete, false);
    assert.ok(state.products['1001']);
    assert.ok(report.stores[0].warnings.some((w) => w.includes('pruned')));
    assert.equal(report.stores[0].notSeenProducts, 0);
});
