# Shopify Product Scraper: Catalog & Prices

Scrape public Shopify product catalog rows from store domains for ecommerce research, price monitoring, product comparison, and catalog reporting. The Actor reads public Shopify `products.json` endpoints and saves clean product rows with titles, brands, prices, MRP, discounts, product types, stock status, image URLs, product URLs, and scrape timestamps.

No Shopify login, Admin API token, app install, or store owner access is required. The Actor only collects public catalog data that the store exposes through its storefront.

## Quick Start

Use this one-product sample to verify output at low cost:

```json
{
  "storeUrls": ["allbirds.com"],
  "maxProductsPerStore": 1,
  "productType": "",
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

Most Shopify stores expose `products.json` openly, so the default proxy setting is off. If a store blocks direct access, enable Apify Proxy and try a Residential proxy group.

## What It Extracts

- Source, store/domain query, result position, and product ID
- Product title, brand/vendor, and product type
- Lowest variant price, compare-at/MRP, discount percentage, and currency placeholder
- First non-default variant title in `packSize`
- Stock status from variant availability
- Product URL, image URL, and ISO scrape timestamp

## Use Cases

- Monitor competitor Shopify prices, MRP, discounts, and stock status
- Build catalog snapshots from one or more Shopify storefronts
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
- Keep proxy off for open stores; enable Residential proxy only for protected stores.
- Use the run's maximum cost setting if you want a strict spending cap.

## Input Fields

| Field | Type | Description |
| --- | --- | --- |
| `storeUrls` | string[] | One to five Shopify domains or URLs, for example `allbirds.com` |
| `maxProductsPerStore` | integer | Maximum products saved per store, up to 1000 |
| `productType` | string | Optional exact product type filter, case-insensitive |
| `proxyConfiguration` | object | Optional Apify Proxy settings. Default is proxy off |

## Sample Output

```json
{
  "source": "shopify",
  "searchQuery": "allbirds.com",
  "position": 1,
  "productId": "7369944137808",
  "title": "Tree Runner - Natural White",
  "brand": "Allbirds",
  "price": 98,
  "mrp": 120,
  "discountPercent": 18,
  "currency": "N/A",
  "packSize": "US 8",
  "category": "Shoes",
  "rating": null,
  "ratingCount": null,
  "inStock": true,
  "productUrl": "https://allbirds.com/products/tree-runner-natural-white",
  "imageUrl": "https://cdn.shopify.com/s/files/example/tree-runner.png",
  "scrapedAt": "2026-06-11T10:00:00.000Z"
}
```

## Reliability Notes

- The Actor reads public `/products.json` data. It does not access hidden, draft, admin-only, customer, order, or inventory-management data.
- Some stores disable or protect `products.json`; those stores may fail unless you use a proxy or may not be accessible.
- Shopify catalogs can expose different fields by theme/app setup. Missing values are saved as `null` or `N/A`.
- The Actor fails zero-product runs instead of silently reporting success with no saved products.

## Responsible Use

This Actor is not affiliated with, endorsed by, or sponsored by Shopify or any scraped store. Use it only for lawful purposes and in compliance with applicable website terms, privacy laws, and local regulations. Do not use it to collect private customer data, order data, admin data, seller contact lists, or non-public information.

## License

Apache License 2.0.
