# US-focused Shopify watchlist positioning

## Store title

Shopify Product Scraper & Price / Stock Monitor

## Store description

Export authorized Shopify catalogs, track variant price and availability changes, and download history-aware JSON/CSV reports. Built for US ecommerce teams; no Shopify API key required.

## Primary audience

US Shopify merchants, DTC ecommerce teams, authorized agency/client-store workflows, and analysts with permission to monitor the selected stores. Supported feeds worldwide remain usable. US audience is not a reason to infer USD.

## Search intent

Shopify product scraper; Shopify products.json export; Shopify price monitor; Shopify stock monitor; Shopify variant price history; Shopify SKU availability; DTC catalog monitoring; ecommerce agency watchlist; Shopify catalog CSV.

## Activation workflow

1. Try the clearly labeled bundled Mock.Shop fixture; it is not live market data.
2. Use one authorized client storefront and one live product with proxy off.
3. Save a 25-product collection watchlist and enable tracking.
4. Repeat with the same name/scope/currency and inspect the exact variant signals and CSV.
5. After validation, the user can set an Apify task schedule in a suitable US timezone. Do not enable a recurring paid schedule on their behalf without authorization.

## Demonstration script

Show a synthetic or authorized-store baseline, then a matching repeat. Explain a variant-only price change while the minimum product price stays unchanged. Show unknown-currency handling, bounded scan warnings, confirmed history status and the changes CSV. Clearly label synthetic fixtures; never present them as a real merchant result.

## Pricing position

Retain $1.50 per 1,000 saved live products plus $0.00005 per start event. Each saved live product includes its returned variants and optional monitoring fields; unchanged products still incur the product event. No separate alert, trend or report events. Do not claim to be the cheapest: rivals advertise lower base prices and differing event structures.

## Publishing / promotion gate

This 1.2 monitoring upgrade is local until a fresh approved cloud build/test sequence passes output, repeat history, reports, memory and recurring-cost gates. Do not announce it as live, publish this copy remotely, change prices, create customer notices or start ads before that gate passes.

## Guardrails

- Do not claim automatic email/Slack alerts or automatically created schedules.
- Do not claim fuzzy cross-store SKU matching, private inventory quantities or complete market coverage.
- Newly observed is not necessarily a launch; not seen is not necessarily deleted.
- No implied permission from public access; no Residential bypass instruction.
- Do not promise USD without source evidence/user declaration.
- Do not promise profitability, customer conversion, first-page SEO placement or access to every storefront.
