# Shopify Product Scraper Promotion Notes

## Short tutorial ideas

- "Scrape Shopify product catalogs to CSV with Apify"
- "Track Shopify competitor prices from public storefront data"
- "Export Shopify products.json rows without an API key"

## 60-second video script

1. Open the Actor and show the one-product `allbirds.com` sample input.
2. Point out `maxProductsPerStore: 1`, product type filter, and proxy off by default.
3. Show an existing dataset row with title, brand, price, MRP, discount, stock, image, and product URL.
4. Export the dataset as CSV or Excel.
5. Mention cost controls: one store, one product, proxy off first, then scale gradually.

## LinkedIn draft

I polished my Shopify Product Scraper on Apify for cleaner storefront catalog research.

It extracts public Shopify product rows from store domains, including product title, brand/vendor, product type, price, compare-at price, discount, stock status, image URL, product URL, and timestamp.

Best first run: `allbirds.com`, `maxProductsPerStore: 1`, proxy off. If a store protects `products.json`, enable Residential proxy and retry.

Useful for ecommerce price snapshots, catalog monitoring, and public storefront research.

## Reddit / Discord draft

I updated a Shopify storefront scraper on Apify that exports public product catalog rows to JSON/CSV/Excel.

It reads public `products.json` endpoints, supports multiple store domains, optional product type filtering, and one-product default runs. Output includes title, brand/vendor, product type, price, compare-at price, discount, stock status, image, and product URL.

Default is intentionally tiny so people can test before scaling.

## SEO keywords

- Shopify scraper
- Shopify product scraper
- Shopify catalog scraper
- Shopify price scraper
- Shopify products.json scraper
- Shopify product data export
- Apify Shopify scraper

## Guardrails

- Do not claim official Shopify Admin API access.
- Do not claim access to hidden, draft, admin, order, customer, or inventory-management data.
- Do not position it as a seller contact, email, phone, or lead-generation scraper.
- Do not promise every store is accessible; some stores protect or disable `products.json`.
- Mention proxy and platform usage when discussing protected stores.
- Use real output samples only.
