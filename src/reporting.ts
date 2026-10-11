import type { MonitoringReport } from './monitoring.js';
import { ShopifyMonitor } from './monitoring.js';
import type { RunStats } from './types.js';

export type ExportWriter = (key: string, value: unknown, contentType?: string) => Promise<unknown>;

export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // A spreadsheet must never interpret source-controlled text as a formula.
    if (typeof value !== 'number' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function changesCsv(report: MonitoringReport): string {
    const fields = ['store', 'productId', 'title', 'productUrl', 'currency', 'status', 'changes', 'variantChanges',
        'previousPrice', 'price', 'priceChange', 'priceChangePercent', 'previousInStock', 'inStock', 'reportDetailsComplete'] as const;
    return [fields.map(csvCell).join(','), ...report.changes.map((row) => fields.map((f) => csvCell(row[f])).join(','))].join('\r\n') + '\r\n';
}

export function reportMarkdown(report: MonitoringReport): string {
    // User/source-controlled strings are not inserted as links or raw markup.
    const safe = (value: string) => value.replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
    return [ '# Shopify price & stock watchlist', '', `Watchlist: ${safe(report.watchlistName)}`, '',
        `Generated: ${report.generatedAt}. Currency: ${report.currencyBasis === 'unknown' ? 'not verified' : 'user-declared, not independently verified'}.`, '',
        '| Store | Observed | Changed | New observations | Not seen | Coverage | History |',
        '| --- | ---: | ---: | ---: | ---: | --- | --- |',
        ...report.stores.map((s) => `| ${safe(s.store)} | ${s.observedProducts} | ${s.changedProducts} | ${s.newlyObservedProducts} | ${s.notSeenProducts} | ${s.scopeComplete ? 'Complete requested scope' : 'Bounded / partial'} | ${s.historyStatus} |`), '',
        ...report.stores.flatMap((s) => s.warnings.map((w) => `- ${safe(s.store)}: ${safe(w)}`)), '',
        ...report.notes.map((n) => `- ${safe(n)}`), '',
        'Use MONITORING-REPORT JSON and CHANGES.csv for machine-readable signals. Baseline/unchanged products remain in the product dataset.', '' ].join('\n');
}

export function runSummary(stats: RunStats): Record<string, unknown> {
    const coverage = Object.values(stats.endpoints ?? {});
    return { ...stats, partial: stats.failedRequests > 0 || stats.skippedRequests > 0 || !!stats.invalidProducts
        || !!stats.spendingLimitReached || !!stats.pageLimitReached || !!stats.repeatedPage,
        scopeComplete: coverage.length > 0 && coverage.every((c) => c.complete && c.stopReason === 'exhausted' && c.invalidProducts === 0),
        boundedScan: coverage.some((c) => c.stopReason === 'product_limit'),
    };
}

export async function finalizeMonitoring(monitor: ShopifyMonitor, stats: RunStats, write: ExportWriter,
    runFailed = false): Promise<MonitoringReport> {
    const report = monitor.plan(stats, runFailed);
    const exportAll = async () => {
        await write('MONITORING-REPORT', report);
        await write('CHANGES.csv', changesCsv(report), 'text/csv; charset=utf-8');
        await write('MONITORING-REPORT.md', reportMarkdown(report), 'text/markdown; charset=utf-8');
        const summary = runSummary(stats);
        await write('RUN_SUMMARY', { ...summary,
            partial: !!summary.partial || report.stores.some((s) => ['withheld', 'conflict', 'commit_failed'].includes(s.historyStatus)),
            monitoring: {
                watchlistName: report.watchlistName, stores: report.stores,
                changeRows: report.changes.length,
                historyConfirmed: report.stores.every((s) => ['committed', 'no_observations'].includes(s.historyStatus)),
            } });
    };
    // Fail before any history mutation if dataset-following reports cannot be delivered.
    await exportAll();
    await monitor.commit(report);
    // Confirm actual history outcomes; failure here is explicit, not an atomic rollback claim.
    await exportAll();
    return report;
}
