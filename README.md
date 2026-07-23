# Shopify Product Scraper: Catalog & Prices

Extract public Shopify product catalog rows from storefronts you own, administer, or have permission to monitor. Real-store runs read public Shopify `products.json` endpoints and save clean product rows with titles, brands, prices, MRP, discounts, product types, stock status, image URLs, product URLs, and scrape timestamps.

No Shopify login, Admin API token, or app install is required. Public availability is not permission by itself: real-store runs require an authorization confirmation, obey `robots.txt`, and stop when access is blocked.

The prefilled `demostore.mock.shop` run uses a bundled, deterministic Mock.Shop demo record rather than contacting the rate-limited demo storefront. Demo output is explicitly marked with `dataOrigin: "bundled_demo"` and `isDemo: true`; it is only for testing the Actor interface and is not charged as a scraped-product event. Real storefront output is marked `dataOrigin: "live_storefront"` and `isDemo: false`.

## Quick Start

Use Shopify's official Mock.Shop demo to verify output at low cost:

```json
{
  "storeUrls": ["demostore.mock.shop"],
  "maxProductsPerStore": 1,
  "productType": "",
  "confirmAuthorizedUse": false,
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

For a real store, replace the demo domain and set `confirmAuthorizedUse` to `true`. The Actor requires HTTPS, blocks local/private network targets and redirects, and respects each store's `robots.txt`. If a store blocks access, do not use a proxy to bypass that restriction.

## What It Extracts

- Source, store/domain query, result position, and product ID
- Product title, brand/vendor, and product type
- Lowest variant price, compare-at/MRP, discount percentage, and currency placeholder
- First non-default variant title in `packSize`
- Stock status from variant availability
- Product URL, image URL, and ISO scrape timestamp

## Use Cases

- Monitor authorized Shopify prices, MRP, discounts, and stock status
- Build catalog snapshots from storefronts you own or are permitted to monitor
- Compare product assortment, categories, brands, and price ranges
- Feed product rows into CSV, Excel, dashboards, or price-change reports
- Schedule repeat runs and diff public product catalogs over time

## Pricing And Cost Control

This Actor uses Apify Pay Per Event pricing. As of the latest live check, active pricing is:

| Event | Price |
| --- | ---: |
| `product-scraped` | `$0.0015` per saved product |
| `apify-actor-start` | `$0.00005` per GB start event |

Products are charged only when a clean row is saved to the dataset. The Actor pushes and charges each product atomically, then stops before further requests when the run's maximum charge is reached.

Platform usage such as compute and proxy traffic may also apply depending on your Apify plan and run configuration. The default run uses 512 MB and proxy off to keep simple Shopify storefront tests light.

Cost-control tips:

- Start with one store and `maxProductsPerStore: 1`.
- Increase the product limit only after the first run confirms the output fits your use case.
- Use `productType` when you only need one store category.
- Keep proxy off unless the store owner has authorized proxy-based access.
- Use the run's maximum cost setting if you want a strict spending cap.

## Input Fields

| Field | Type | Description |
| --- | --- | --- |
| `storeUrls` | string[] | One to five Shopify domains or HTTPS URLs |
| `maxProductsPerStore` | integer | Maximum products saved per store, up to 1000 |
| `productType` | string | Optional exact product type filter, case-insensitive |
| `confirmAuthorizedUse` | boolean | Required for any store other than the official demo |
| `proxyConfiguration` | object | Optional Apify Proxy settings. Default is proxy off |

## Sample Output

```json
{
  "source": "shopify",
  "dataOrigin": "bundled_demo",
  "isDemo": true,
  "searchQuery": "demostore.mock.shop",
  "position": 1,
  "productId": "10489561382934",
  "title": "Hoodie",
  "brand": "Mock.shop",
  "price": 90,
  "mrp": null,
  "discountPercent": null,
  "currency": "N/A",
  "packSize": "Clay / Small",
  "category": "N/A",
  "rating": null,
  "ratingCount": null,
  "inStock": true,
  "productUrl": "https://demostore.mock.shop/products/hoodie",
  "imageUrl": "https://cdn.shopify.com/s/files/1/0688/1755/1382/products/ClayHoodie01.jpg",
  "scrapedAt": "2026-07-18T13:32:29.858Z"
}
```

## Reliability Notes

- Real-store runs read public `/products.json` data. The prefilled demo uses a clearly labeled bundled fixture and does not make a storefront request.
- The Actor does not access hidden, draft, admin-only, customer, order, or inventory-management data.
- The default test uses Shopify's publicly available Mock.Shop demo rather than a third-party merchant.
- HTTPS, public-network validation, disabled redirects, response-size limits, and `robots.txt` checks reduce unsafe or accidental access.
- Some stores disable or protect `products.json`; those stores are not accessible with this Actor.
- Shopify catalogs can expose different fields by theme/app setup. Missing values are saved as `null` or `N/A`.
- Rows without a product ID, title, price, or product URL are rejected before billing.
- The Actor fails zero-product runs instead of silently reporting success with no saved products.

## Responsible Use

This Actor is not affiliated with, endorsed by, or sponsored by Shopify or any monitored store. Use it only for stores you own, administer, or have permission to monitor, and comply with applicable website terms, privacy laws, and local regulations. Do not use it to bypass access restrictions or collect private customer, order, admin, contact-list, or non-public information.

## License

Apache License 2.0.
