import { createHash, randomUUID } from 'node:crypto';
import type { NormalizedInput } from './input.js';
import type { RequestPlan } from './request-plan.js';
import type { ProductRecord, RunStats, VariantChange } from './types.js';

export const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_RETAINED_PRODUCTS = 1000;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const productIdPattern = /^[1-9]\d{0,19}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface StateStore {
    getValue(key: string): Promise<unknown>;
    setValue(key: string, value: unknown): Promise<unknown>;
}
export interface MonitorScope {
    origin: string;
    endpoints: string[];
    key: string;
    currency: string;
}
interface Observation { at: string; price: number | null; inStock: boolean | null }
interface VariantSnapshot {
    id: number;
    sku: string | null;
    price: number | null;
    compareAtPrice: number | null;
    available: boolean | null;
}
interface Snapshot {
    id: string;
    title: string;
    url: string;
    price: number | null;
    inStock: boolean | null;
    catalogHash: string;
    variants: VariantSnapshot[];
    firstObservedAt: string;
    observationCount: number;
    history: Observation[];
}
interface StoredState {
    version: 1;
    scopeKey: string;
    revision: string;
    observedAt: string;
    complete: boolean;
    products: Record<string, Snapshot>;
}
export interface ChangeRow {
    store: string;
    productId: string;
    title: string;
    productUrl: string;
    currency: string;
    status: string;
    changes: string[];
    variantChanges: VariantChange[];
    previousPrice: number | null;
    price: number | null;
    priceChange: number | null;
    priceChangePercent: number | null;
    previousInStock: boolean | null;
    inStock: boolean | null;
    reportDetailsComplete?: boolean;
}
export interface StoreReport {
    store: string;
    scopeKey: string;
    endpoints: string[];
    scopeComplete: boolean;
    observedProducts: number;
    baselineProducts: number;
    newlyObservedProducts: number;
    changedProducts: number;
    unchangedProducts: number;
    notSeenProducts: number;
    historyStatus: 'pending' | 'committed' | 'withheld' | 'no_observations' | 'conflict' | 'commit_failed';
    warnings: string[];
}
export interface MonitoringReport {
    version: 1;
    watchlistName: string;
    historyStoreName: string;
    generatedAt: string;
    currencyBasis: 'user_declared' | 'unknown';
    stores: StoreReport[];
    changes: ChangeRow[];
    notes: string[];
}
interface Session {
    scope: MonitorScope;
    previous: StoredState | null;
    observed: Map<string, Snapshot>;
    rows: Map<string, ChangeRow>;
    candidate?: StoredState;
    observedIds: Set<string>;
    observationBytes: number;
    reportBytes: number;
    trackingOverflow: boolean;
    detailsLimited: boolean;
}

export function watchlistStoreName(name: string): string {
    return `shopify-watchlist-v1-${digest(name).slice(0, 24)}`;
}

export function monitorScopes(plans: RequestPlan[], input: NormalizedInput): MonitorScope[] {
    return [...new Set(plans.map((p) => p.origin))].sort().map((origin) => {
        const endpoints = [...new Set(plans.filter((p) => p.origin === origin).map((p) => p.endpoint))].sort();
        const key = digest({ version: 1, origin, endpoints, filter: input.productType.toLowerCase(),
            limit: input.maxProductsPerStore, currency: input.storeCurrency });
        return { origin, endpoints, key, currency: input.storeCurrency };
    });
}

const nullableNumber = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const nullableBoolean = (v: unknown): boolean => v === null || typeof v === 'boolean';
const validDate = (v: unknown): v is string => typeof v === 'string' && datePattern.test(v) && Number.isFinite(Date.parse(v));
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateState(raw: unknown, scope: MonitorScope): StoredState | null {
    if (raw === null || raw === undefined) return null;
    const fail = (): never => { throw new Error('Saved Shopify history is invalid or oversized; use a new watchlist name or repair the private store. History was not reset.'); };
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_STATE_BYTES) fail();
    if (!object(raw) || raw.version !== 1 || raw.scopeKey !== scope.key || typeof raw.revision !== 'string'
        || !/^[a-zA-Z0-9_-]{1,80}$/.test(raw.revision) || !validDate(raw.observedAt)
        || typeof raw.complete !== 'boolean' || !object(raw.products)) fail();
    const state = raw as Record<string, any>;
    if (Object.keys(state.products).length > MAX_RETAINED_PRODUCTS) fail();
    for (const [id, p] of Object.entries(state.products as Record<string, any>)) {
        if (!object(p) || !productIdPattern.test(id) || p.id !== id || typeof p.title !== 'string' || p.title.length > 500
            || typeof p.url !== 'string' || !p.url.startsWith(`${scope.origin}/products/`)
            || !/^[a-zA-Z0-9_-]+$/.test(p.url.slice(`${scope.origin}/products/`.length))
            || !nullableNumber(p.price) || !nullableBoolean(p.inStock) || !/^[a-f0-9]{64}$/.test(p.catalogHash)
            || !validDate(p.firstObservedAt) || !Number.isSafeInteger(p.observationCount) || p.observationCount < 1
            || !Array.isArray(p.history) || p.history.length < 1 || p.history.length > 30
            || p.observationCount < p.history.length || !Array.isArray(p.variants) || p.variants.length > 2000) fail();
        const ids = new Set<number>();
        for (const v of p.variants) {
            if (!object(v) || !Number.isSafeInteger(v.id) || v.id <= 0 || ids.has(v.id)
                || !(v.sku === null || (typeof v.sku === 'string' && v.sku.length <= 256))
                || !nullableNumber(v.price) || !nullableNumber(v.compareAtPrice) || !nullableBoolean(v.available)) fail();
            ids.add(v.id);
        }
        for (const h of p.history) {
            if (!object(h) || !validDate(h.at) || !nullableNumber(h.price) || !nullableBoolean(h.inStock)) fail();
        }
    }
    return raw as unknown as StoredState;
}

export function withCurrency(record: ProductRecord, currency: string): ProductRecord {
    return { ...record, currency: currency || record.currency,
        currencySource: currency ? 'user_declared' : 'not_exposed' };
}

function stableVariants(record: ProductRecord): VariantSnapshot[] {
    const counts = new Map<number, number>();
    for (const v of record.variants) if (v.variantId !== null) counts.set(v.variantId, (counts.get(v.variantId) ?? 0) + 1);
    return record.variants.filter((v) => v.variantId !== null && Number.isSafeInteger(v.variantId)
        && v.variantId > 0 && counts.get(v.variantId) === 1).map((v) => ({ id: v.variantId!,
            sku: v.sku === null ? null : v.sku.slice(0, 256), price: v.price,
            compareAtPrice: v.compareAtPrice, available: v.available })).sort((a, b) => a.id - b.id);
}

function snapshot(record: ProductRecord, previous: Snapshot | undefined, historyLimit: number): Snapshot {
    return { id: record.productId!, title: record.title.slice(0, 500), url: record.productUrl!,
        price: record.price, inStock: record.inStock,
        catalogHash: digest({ title: record.title, brand: record.brand, category: record.category,
            tags: [...record.tags].sort(), images: [...record.images].sort(), description: record.description,
            url: record.productUrl, variants: record.variants.map((v) => [v.variantId, v.title, v.sku, v.requiresShipping, v.grams])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]))) }),
        variants: stableVariants(record), firstObservedAt: previous?.firstObservedAt ?? record.scrapedAt,
        observationCount: (previous?.observationCount ?? 0) + 1,
        history: [...(previous?.history ?? []), { at: record.scrapedAt, price: record.price, inStock: record.inStock }].slice(-historyLimit) };
}

function priceDelta(previous: number | null, current: number | null, verified: boolean): { delta: number | null; percent: number | null } {
    if (!verified || previous === null || current === null) return { delta: null, percent: null };
    const delta = Number((current - previous).toFixed(6));
    const ratio = previous > 0 ? delta / previous * 100 : NaN;
    return { delta: Number.isFinite(delta) ? delta : null,
        percent: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null };
}

function stockChange(previous: boolean | null, current: boolean | null): string[] {
    return typeof previous === 'boolean' && typeof current === 'boolean' && previous !== current
        ? [current ? 'restocked' : 'sold_out'] : previous !== current ? ['availability_evidence_changed'] : [];
}

function compareVariants(previous: Snapshot, current: Snapshot, verified: boolean, currentIdsComplete: boolean): VariantChange[] {
    const before = new Map(previous.variants.map((v) => [v.id, v]));
    const after = new Map(current.variants.map((v) => [v.id, v]));
    return [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b).flatMap((id) => {
        const p = before.get(id), c = after.get(id);
        const changes: string[] = [];
        if (!c && !currentIdsComplete) return [];
        if (!p || !c) changes.push(p ? 'variant_not_seen' : 'variant_newly_observed');
        else {
            if (p.price !== c.price) changes.push(verified && p.price !== null && c.price !== null
                ? c.price < p.price ? 'price_drop' : 'price_increase' : 'price_value_changed');
            if (p.compareAtPrice !== c.compareAtPrice) changes.push('compare_at_changed');
            changes.push(...stockChange(p.available, c.available));
            if (p.sku !== c.sku) changes.push('sku_changed');
            if (verified && p.price !== null && c.price !== null) {
                const wasSale = p.compareAtPrice !== null && p.compareAtPrice > p.price;
                const isSale = c.compareAtPrice !== null && c.compareAtPrice > c.price;
                if (wasSale !== isSale) changes.push(isSale ? 'sale_started' : 'sale_ended');
            }
        }
        if (!changes.length) return [];
        const delta = priceDelta(p?.price ?? null, c?.price ?? null, verified && !!p && !!c);
        return [{ variantId: id, sku: c?.sku ?? p?.sku ?? null, changes,
            previousPrice: p?.price ?? null, price: c?.price ?? null,
            priceChange: delta.delta, priceChangePercent: delta.percent,
            previousAvailable: p?.available ?? null, available: c?.available ?? null }];
    });
}

export class ShopifyMonitor {
    private constructor(private readonly sessions: Map<string, Session>, private readonly stateStore: StateStore,
        private readonly input: NormalizedInput) {}

    static async load(scopes: MonitorScope[], store: StateStore, input: NormalizedInput): Promise<ShopifyMonitor> {
        const sessions = new Map<string, Session>();
        for (const scope of scopes) {
            const previous = validateState(await store.getValue(scope.key), scope);
            sessions.set(scope.origin, { scope, previous, observed: new Map(), rows: new Map(), observedIds: new Set(),
                observationBytes: 0, reportBytes: 0, trackingOverflow: false, detailsLimited: false });
        }
        return new ShopifyMonitor(sessions, store, input);
    }

    prepare(record: ProductRecord): ProductRecord {
        const session = this.sessions.get(new URL(record.productUrl!).origin);
        if (!session || record.isDemo) return withCurrency(record, this.input.storeCurrency);
        const previous = session.previous?.products[record.productId!];
        const current = snapshot(record, previous, this.input.maxHistoryPoints);
        const verified = !!session.scope.currency;
        const changes: string[] = [];
        const variantChanges = previous ? compareVariants(previous, current, verified, current.variants.length === record.variants.length) : [];
        if (previous) {
            if (previous.price !== current.price) changes.push(verified && previous.price !== null && current.price !== null
                ? current.price < previous.price ? 'price_drop' : 'price_increase' : 'price_value_changed');
            changes.push(...stockChange(previous.inStock, current.inStock));
            if (previous.catalogHash !== current.catalogHash) changes.push('catalog_details_changed');
            if (variantChanges.length) changes.push('variants_changed');
        }
        const warnings: string[] = [];
        if (!verified) warnings.push('currency_not_verified; numeric changes are not currency-verified price alerts');
        if (record.inStock === null) warnings.push('availability_not_exposed');
        if (current.variants.length !== record.variants.length) warnings.push('some_variants_have_missing_or_duplicate_ids; those variants are not matched');
        if (record.variants.some((v) => v.sku && v.sku.length > 256)) warnings.push('long_skus_truncated_in_history; full_values_remain_in_dataset');
        if (current.variants.length > 2000) warnings.push('variant_history_limit_exceeded; history_will_not_advance');
        if (session.previous && !session.previous.complete) warnings.push('previous_scan_partial; newly_observed_does_not_mean_new_product_launch');
        const delta = priceDelta(previous?.price ?? null, current.price, verified && !!previous);
        const prices = current.history.map((h) => h.price).filter((p): p is number => p !== null);
        return { ...withCurrency(record, session.scope.currency), watchlistName: this.input.watchlistName,
            monitoringStatus: previous ? changes.length ? 'changed' : 'unchanged' : session.previous ? 'newly_observed' : 'baseline',
            changes, variantChanges, previousPrice: previous?.price ?? null,
            priceChange: delta.delta, priceChangePercent: delta.percent, previousInStock: previous?.inStock ?? null,
            firstObservedAt: current.firstObservedAt, observationCount: current.observationCount,
            historyPoints: current.history.length, minObservedPrice: prices.length ? Math.min(...prices) : null,
            maxObservedPrice: prices.length ? Math.max(...prices) : null,
            priceComparisonBasis: previous ? verified ? 'user_declared_same_currency' : 'unverified_currency' : 'no_previous_observation',
            dataQualityWarnings: warnings };
    }

    saved(record: ProductRecord): void {
        if (record.isDemo || record.dataOrigin !== 'live_storefront') return;
        const session = this.sessions.get(new URL(record.productUrl!).origin);
        if (!session) return;
        // Called only after dataset persistence/charging accepted the row.
        session.observedIds.add(record.productId!);
        if (!session.trackingOverflow) {
            const next = snapshot(record, session.previous?.products[record.productId!], this.input.maxHistoryPoints);
            const bytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
            if (session.observationBytes + bytes > MAX_STATE_BYTES || next.variants.length > 2000) {
                session.trackingOverflow = true;
                session.observed.clear();
            } else { session.observed.set(record.productId!, next); session.observationBytes += bytes; }
        }
        // Retain compact report fields, not descriptions/images/full catalog rows.
        const reportRow: ChangeRow = { store: new URL(session.scope.origin).host, productId: record.productId!,
            title: record.title.slice(0, 500), productUrl: record.productUrl!, currency: record.currency,
            status: record.monitoringStatus ?? 'unavailable', changes: record.changes ?? [],
            variantChanges: record.variantChanges ?? [], previousPrice: record.previousPrice ?? null,
            price: record.price, priceChange: record.priceChange ?? null, priceChangePercent: record.priceChangePercent ?? null,
            previousInStock: record.previousInStock ?? null, inStock: record.inStock, reportDetailsComplete: true };
        if (session.reportBytes + Buffer.byteLength(JSON.stringify(reportRow), 'utf8') > MAX_STATE_BYTES) {
            reportRow.variantChanges = [];
            reportRow.reportDetailsComplete = false;
            session.detailsLimited = true;
        }
        session.reportBytes += Buffer.byteLength(JSON.stringify(reportRow), 'utf8');
        session.rows.set(record.productId!, reportRow);
    }

    plan(stats: RunStats, runFailed = false): MonitoringReport {
        const report: MonitoringReport = { version: 1, watchlistName: this.input.watchlistName,
            historyStoreName: watchlistStoreName(this.input.watchlistName),
            generatedAt: new Date().toISOString(), currencyBasis: this.input.storeCurrency ? 'user_declared' : 'unknown',
            stores: [], changes: [], notes: [
                'Only saved live products advance history. Reports and summary are exported before history writes.',
                'One saved live product is one product event, including unchanged observations; no extra report or variant event.',
                'Do not overlap runs of the same watchlist. Revision checking detects conflicts but is not an atomic lock.',
                'Not seen is not proof of deletion. Stock is public availability, not private inventory quantity.',
            ] };
        for (const session of this.sessions.values()) {
            session.candidate = undefined;
            const { scope, previous, observed, rows } = session;
            const coverage = scope.endpoints.map((endpoint) => stats.endpoints?.[endpoint]);
            const complete = coverage.every((c) => !!c && c.complete && c.invalidProducts === 0 && c.stopReason === 'exhausted');
            const safe = !runFailed && !stats.spendingLimitReached && !session.trackingOverflow && coverage.every((c) => !!c && c.invalidProducts === 0
                && (c.stopReason === 'exhausted' || c.stopReason === 'product_limit'));
            const counts = { baseline: 0, newly_observed: 0, changed: 0, unchanged: 0 };
            for (const row of rows.values()) {
                const status = row.status as keyof typeof counts;
                if (status in counts) counts[status]++;
                if (status === 'changed' || status === 'newly_observed') report.changes.push(row);
            }
            const storeReport: StoreReport = { store: new URL(scope.origin).host, scopeKey: scope.key, endpoints: scope.endpoints,
                scopeComplete: complete, observedProducts: session.observedIds.size, baselineProducts: counts.baseline,
                newlyObservedProducts: counts.newly_observed, changedProducts: counts.changed, unchangedProducts: counts.unchanged,
                notSeenProducts: 0, historyStatus: safe ? observed.size || complete ? 'pending' : 'no_observations' : 'withheld',
                warnings: [] };
            if (!complete) storeReport.warnings.push('Scan is bounded or incomplete; unseen products are not treated as removed.');
            if (!safe) storeReport.warnings.push('History withheld because scan, spending or history safety checks did not pass.');
            if (session.trackingOverflow) storeReport.warnings.push('Compact observations exceeded 4 MiB or 2,000 variants per product; history withheld. Reduce the limit.');
            if (session.detailsLimited) storeReport.warnings.push('Some report variant details were capped at 4 MiB per store; complete details remain in the product dataset.');
            if (safe && complete && previous?.complete) {
                for (const p of Object.values(previous.products)) if (!observed.has(p.id)) {
                    storeReport.notSeenProducts++;
                    report.changes.push({ store: storeReport.store, productId: p.id, title: p.title, productUrl: p.url,
                        currency: scope.currency || 'N/A', status: 'not_seen_in_complete_scope', changes: ['not_seen_in_complete_scope'],
                        variantChanges: [], previousPrice: p.price, price: null, priceChange: null, priceChangePercent: null,
                        previousInStock: p.inStock, inStock: null });
                }
            }
            if (storeReport.historyStatus === 'pending') {
                const products = new Map<string, Snapshot>(complete ? [] : Object.entries(previous?.products ?? {}));
                for (const [id, p] of observed) products.set(id, p);
                if (products.size > MAX_RETAINED_PRODUCTS) {
                    const newest = [...products.entries()].sort((a, b) => b[1].history.at(-1)!.at.localeCompare(a[1].history.at(-1)!.at));
                    products.clear();
                    for (const [id, p] of newest.slice(0, MAX_RETAINED_PRODUCTS)) products.set(id, p);
                    storeReport.warnings.push('History retained the 1,000 most recently observed products; older partial-scan entries were pruned.');
                }
                const candidate: StoredState = { version: 1, scopeKey: scope.key, revision: randomUUID(), observedAt: report.generatedAt,
                    complete, products: Object.fromEntries(products) };
                if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_STATE_BYTES) {
                    storeReport.historyStatus = 'withheld';
                    storeReport.warnings.push('Compact history exceeded 4 MiB; reduce the product limit. Dataset and reports remain available.');
                } else session.candidate = candidate;
            }
            report.stores.push(storeReport);
        }
        return report;
    }

    async commit(report: MonitoringReport): Promise<void> {
        for (const session of this.sessions.values()) {
            if (!session.candidate) continue;
            const storeReport = report.stores.find((s) => s.scopeKey === session.scope.key)!;
            try {
                const latest = validateState(await this.stateStore.getValue(session.scope.key), session.scope);
                if ((latest?.revision ?? null) !== (session.previous?.revision ?? null)) {
                    storeReport.historyStatus = 'conflict';
                    storeReport.warnings.push('Another run changed this baseline; history was not overwritten. Run this watchlist sequentially.');
                    continue;
                }
                await this.stateStore.setValue(session.scope.key, session.candidate);
                storeReport.historyStatus = 'committed';
            } catch {
                storeReport.historyStatus = 'commit_failed';
                storeReport.warnings.push('Private history could not be saved; the delivered dataset and reports remain available.');
            }
        }
    }
}
