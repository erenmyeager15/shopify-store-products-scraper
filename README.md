# Shopify Product Scraper & Price / Stock Monitor

Turn an authorized Shopify storefront into a repeatable catalog, price and availability watchlist. Built for US ecommerce merchants, DTC teams and agencies managing client stores; works with supported public Shopify feeds worldwide.

Export products, variants and SKUs, compare repeat observations, and download JSON/CSV reports without a Shopify Admin API key or app install. No additional storefront requests are made just to compute history or change reports. Monitoring does use private storage operations.

## Start with a transparent demo

The prefilled `demostore.mock.shop` input returns a **bundled, deterministic Mock.Shop fixture**, not a live scrape. It is marked `dataOrigin: "bundled_demo"` and `isDemo: true`. It tests the interface, not live access, price changes or profitability. Demo products have no scraped-product fee; the Actor start event still applies.

```json
{
  "storeUrls": ["demostore.mock.shop"],
  "maxProductsPerStore": 1,
  "confirmAuthorizedUse": false,
  "trackChanges": false,
  "proxyConfiguration": { "useApifyProxy": false }
}
```

For live data, supply a storefront you own, administer or have permission to monitor and set `confirmAuthorizedUse: true`. Public availability alone is not permission. Blocked, private, admin and password-protected stores are not supported.

## US merchant / agency watchlist

Save this configuration as an Apify task after replacing the example domain with an authorized store. The domain below is a placeholder, not a tested merchant.

```json
{
  "storeUrls": ["https://your-authorized-store.example/collections/shoes"],
  "maxProductsPerStore": 25,
  "productType": "",
  "confirmAuthorizedUse": true,
  "trackChanges": true,
  "watchlistName": "client-shoes-us",
  "maxHistoryPoints": 10,
  "storeCurrency": "",
  "proxyConfiguration": { "useApifyProxy": false }
}
```

1. Run once to save a baseline of successfully delivered products.
2. Repeat with the same watchlist name, URLs, filter, limit and currency to see changes.
3. Review the **Price & Stock Watchlist** dataset view and run reports.
4. If the workflow meets your needs, use [Apify schedules](https://docs.apify.com/actors/running/schedules) with an appropriate US timezone, such as America/New_York. Run the same watchlist sequentially, not concurrently.
5. Connect the reports to your own dashboard or an Apify integration. The Actor does not automatically create schedules or send email/Slack notifications.

A daily 25-product watchlist costs **$0.03755 per successful run at base event prices**, or approximately **$1.13 for 30 runs**, assuming one start event per 256 MB run and exactly 25 saved live products each time. These are customer event-price examples, not an author-profit estimate or a guarantee of store accessibility.

Use separate watchlist names for clients. Changing scope, filter, per-store limit or declared currency creates an isolated baseline. Changing the retained history length does not discard the existing first-observed time.

## What makes the reports useful

| Capability | What you receive |
| --- | --- |
| Stable product and variant matching | Product IDs and exact variant IDs, not fuzzy title or cross-store SKU guesses |
| Variant-level price and stock changes | A change to one variant is visible even if the product's minimum price or overall availability stays unchanged |
| Price evidence | Previous/current minimum price, declared-currency deltas and percentages; raw value changes when currency is unknown |
| Availability evidence | Restock/sold-out signals only when both observations expose boolean availability; unknown never becomes false |
| Sale signals | Compare-at and selling prices from the same variant; no cross-variant discount calculation |
| Observation history | First-observed time, delivered observation count, and retained-window minimum/maximum prices |
| Honest coverage | Capped scans never label unseen products removed; not-seen signals need two complete scans of the same requested scope |
| Export and billing safeguards | Reports before history commits; no history advancement after rejected delivery, unsafe scan or failed initial report export |
| Compact storage | 2–30 observations per product, up to 1,000 retained products per scope, with history size limits |

Basic monitoring is available elsewhere too. This Actor emphasizes exact variant evidence, cautious partial-scan interpretation and included reports—not a claim that tracking itself is exclusive.

### Currency and stock limitations

Shopify's public feed does not consistently establish currency. US users or a US store address do **not** prove USD. Leave `storeCurrency` empty to retain `N/A`, or declare a three-letter code only when you know every selected feed uses it. Declared currency is labeled `user_declared`, not independently verified. Use separate runs for feeds in different currencies.

Unknown-currency observations expose `price_value_changed`, but currency-dependent price deltas and percentage alerts are withheld. Minimum/maximum values are raw retained feed values. Prices do not establish shipping, taxes, checkout discounts or final delivered cost. Public availability is not private inventory quantity.

## Catalog fields and scope

One product row contains title, vendor/brand, product type, handle URL, minimum/maximum variant price, same-variant compare-at price, discount percentage, availability, nested variants/SKUs, images, plain-text description, tags and timestamp. Ratings are not invented.

Supported input paths:

- Store root, `/products` or `/products.json`
- Clean `/collections/handle` paths
- Clean `/products/handle` paths

Queries, fragments, unsupported paths, credentials, non-HTTPS targets, custom ports and private-network targets are rejected. Redirects are disabled and `robots.txt` is respected. A product is saved once per store even across overlapping scopes; the product limit is shared by all scopes of that store.

Pagination stops at the configured product limit, 20-page safety limit or a repeated source page. Exact product-type filters may require additional pages to find matches; narrow collection URLs often make a more efficient watchlist. A bounded scan is **not** a complete storefront audit.

Requests to the same store are spaced out. Each page has at most one source retry; a 429 rate limit waits at least two seconds and respects `Retry-After` up to 15 seconds. A longer server cooldown stops that page rather than retrying too early. Access-denied responses (401/403) are not retried. `RUN_SUMMARY` exposes retry attempts, recovered requests, rate-limit responses and stops separately from final failed pages. A recovery is not a claim that the source never throttled the run.

## Run outputs

| Output | Contents |
| --- | --- |
| Product dataset | Every successfully saved product, including baseline and unchanged observations |
| `RUN_SUMMARY` | Saved rows, page outcomes, complete/bounded/partial flags, spending stop and monitoring outcomes |
| `MONITORING-REPORT` | Optional JSON signals, per-store coverage, history save status and warnings |
| `CHANGES.csv` | Optional changes-only export, with source-text formula protection |
| `MONITORING-REPORT.md` | Optional readable coverage and observation summary |

Monitoring reports are generated only for live runs with `trackChanges: true`. First baselines and unchanged repeats can have a header-only changes CSV. Newly observed means newly observed in this watchlist—not proof of a new product launch. `not_seen_in_complete_scope` is not proof of deletion or being out of stock.

Large report variant details may be capped and flagged with `reportDetailsComplete: false`; complete delivered row signals remain in the product dataset.

Illustrative field subset from a **synthetic variant-change test**, not a live merchant result:

```json
{
  "monitoringStatus": "changed",
  "price": 10,
  "previousPrice": 10,
  "currency": "USD",
  "currencySource": "user_declared",
  "changes": ["variants_changed"],
  "variantChanges": [{
    "variantId": 102,
    "sku": "shoe-b",
    "changes": ["price_drop"],
    "previousPrice": 20,
    "price": 18,
    "priceChange": -2,
    "priceChangePercent": -10,
    "previousAvailable": false,
    "available": false
  }]
}
```

The headline price remained 10, while a different variant fell from 20 to 18.

## Pricing and cost controls

Active event prices checked October 11, 2026:

| Event | Customer price |
| --- | ---: |
| `product-scraped` | **$1.50 / 1,000 saved live products** |
| `apify-actor-start` | **$0.00005 per start event**, one per GB, minimum one |

Platform usage is included in the current pay-per-event price. One saved live product includes its returned variants and optional monitoring fields. There are **no additional variant, alert, trend or report events**. Unchanged saved live products are still charged; changes-only CSV does not turn the source scan into a free scan.

Default resources remain **256 MB, proxy off**. There is no automatic Residential or browser fallback. Explicit proxy settings remain supported for authorized access, not for bypassing store restrictions. No profitability guarantee is made: author economics depend on actual compute, storage, transfer, retries, proxy use and free-user traffic.

Start with one store and one product. Set the run's maximum charge to control product-event charges. Allowance is checked before live setup, navigation and each delivery. In-flight requests and delayed infrastructure accounting mean this is not a guaranteed cap on all costs.

## Input reference

| Field | Default | Purpose |
| --- | --- | --- |
| `storeUrls` | Bundled Mock.Shop fixture | 1–5 store/collection/product URLs |
| `maxProductsPerStore` | 1 | Shared per-store cap, 1–1,000 |
| `productType` | Empty | Exact case-insensitive product type |
| `confirmAuthorizedUse` | false | Required for live storefronts |
| `trackChanges` | false | Enable private repeat comparisons and reports |
| `watchlistName` | shopify-us-watchlist | Stable client/workflow identifier, 1–80 safe characters |
| `maxHistoryPoints` | 10 | Retain 2–30 recent delivered observations |
| `storeCurrency` | Empty | Optional user-declared three-letter code |
| `proxyConfiguration` | Proxy off | Explicit authorized proxy only |

## History, failures and privacy

Private history uses a named Apify key-value store whose name begins `shopify-watchlist-v1-`; the JSON report identifies the full name. Named stores persist until you remove them, so clean up inactive watchlists and old scope baselines in your Apify Storage console. The per-scope limits do not automatically delete old watchlist stores or scope keys. See [Apify key-value storage](https://docs.apify.com/storage/key-value-store).

Only delivered live observations are eligible to advance history. Failed, skipped, repeated, invalid, spending-limited or history-oversized scans withhold the affected baseline. A valid configured cap can merge observed products into partial history, but cannot infer unseen-product removal.

Reports and the summary are written before history commits; a second export confirms the commit outcome. An initial export failure leaves history untouched. A confirmation export can fail after history was committed—there is no cross-service transaction or automatic rollback. Check `RUN_SUMMARY` after errors.

Do not overlap runs for the same watchlist. Revision checks detect a changed baseline, but the key-value service is not used as an atomic compare-and-swap lock. Corrupt/oversized saved history fails explicitly instead of silently becoming a new baseline.

Valid empty catalogs/filters can return zero products. Blocked or malformed zero-result runs fail. Multi-store runs may deliver partial results if a store fails: check page outcomes and per-store history status, not just the green run label.

## Responsible use

Not affiliated with or endorsed by Shopify or any monitored merchant. Use only authorized storefronts and comply with applicable website terms and privacy requirements. No hidden/draft/admin, customer, order, private contact or private inventory data is collected. Protected feeds may remain inaccessible; no proxy setting removes the need for permission.

## License

Apache License 2.0.
