# Shopify Store Products Scraper - Products, Variants & Prices

Extract the **full product catalog from any Shopify store** - no login, no API key, no app required. Get products, variants, prices, compare-at prices, SKUs, availability, images, vendors, product types, tags, and options. Export to **JSON, CSV, Excel, or HTML**, or pull via the Apify API.

Perfect for **competitor price monitoring, e-commerce research, dropshipping, lead generation, and catalog analysis**.

## Features

- ✅ **No login or API key** - uses each store's public `products.json` endpoint
- ✅ **Any Shopify store** - just pass the domain
- ✅ **Multiple stores per run**
- ✅ **Complete product data** - variants, prices, SKUs, availability, images, options, tags
- ✅ **Automatic pagination** - scrape the entire catalog or cap it
- ✅ **Fast & lightweight** - pure JSON, no headless browser
- ✅ **Filter by product type**

## Input

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `storeUrls` | `string[]` | Shopify store domains or URLs, e.g. `"allbirds.com"` | `["allbirds.com"]` |
| `maxProductsPerStore` | `integer` | Max products per store (`0` = all) | `1000` |
| `productType` | `string` | Keep only this product type (exact, case-insensitive) | `""` (all) |
| `proxyConfiguration` | `object` | Proxy (residential helps for protected stores) | Apify Proxy |

### Example input

```json
{
  "storeUrls": ["allbirds.com", "https://www.mvmt.com"],
  "maxProductsPerStore": 500,
  "proxyConfiguration": { "useApifyProxy": true }
}
```

## Sample output

```json
{
  "productId": 7369944137808,
  "title": "Tree Runner - Natural White",
  "handle": "tree-runner-natural-white",
  "description": "Our lightweight, breathable everyday sneaker...",
  "vendor": "Allbirds",
  "productType": "Shoes",
  "tags": ["mens", "sneakers"],
  "storeDomain": "allbirds.com",
  "productUrl": "https://allbirds.com/products/tree-runner-natural-white",
  "minPrice": 98,
  "maxPrice": 98,
  "available": true,
  "variantsCount": 12,
  "variants": [
    { "variantId": 42436493115472, "title": "US 8", "sku": "TR-NW-8", "price": 98, "compareAtPrice": null, "available": true, "requiresShipping": true, "grams": 300 }
  ],
  "imageUrl": "https://cdn.shopify.com/s/files/.../tree-runner.png",
  "images": ["https://cdn.shopify.com/s/files/.../tree-runner.png"],
  "options": [{ "name": "Size", "values": ["US 8", "US 9", "US 10"] }],
  "createdAt": "2026-06-05T07:14:57-07:00",
  "updatedAt": "2026-06-10T13:31:29-07:00",
  "publishedAt": "2026-06-05T07:23:55-07:00",
  "scrapedAt": "2026-06-11T10:00:00.000Z"
}
```

## Pricing

This Actor uses **pay-per-result** pricing:

| Event | Price |
|-------|-------|
| Per product scraped | **$0.0015** ($1.50 / 1,000 products) |

You are only charged for products actually extracted. Apify platform usage and proxy traffic are billed separately by Apify.

## Use cases

- **Competitor price monitoring** - track rival catalogs, prices, and stock
- **Dropshipping / product research** - find products, vendors, and pricing
- **E-commerce analytics** - analyze assortments, tags, and variant structures
- **Lead generation** - build datasets of products across many stores
- **Price-change alerts** - run on a schedule and diff results

## How to Scrape Shopify Store Products (Step by Step)

1. Click **Try for free** / **Run**.
2. Enter one or more Shopify store domains in `storeUrls` (e.g. `allbirds.com`).
3. Set `maxProductsPerStore` (start small to test, or `0` for the entire catalog).
4. Optionally filter by `productType`, then click **Run**.
5. When the run finishes, export results to JSON, CSV, Excel, or HTML, or pull them via the Apify API.

## Notes & tips

- Most Shopify stores serve `products.json` openly. A minority add bot protection - enable **residential proxies** for those, or they'll be skipped gracefully.
- The actor reads the public `products.json` endpoint, so it returns published catalog data (not hidden/draft products).
- Set `maxProductsPerStore: 0` to scrape an entire catalog.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
