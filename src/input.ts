import type { ActorInput, ProxyInput } from './types.js';
import { OFFICIAL_DEMO_HOST } from './url-safety.js';

export interface NormalizedInput {
    storeUrls: string[];
    maxProductsPerStore: number;
    productType: string;
    confirmAuthorizedUse: boolean;
    trackChanges: boolean;
    watchlistName: string;
    maxHistoryPoints: number;
    storeCurrency: string;
    proxyConfiguration?: ProxyInput;
}

const DEFAULT_MAX_PRODUCTS_PER_STORE = 1;
const MAX_PRODUCTS_PER_STORE = 1000;

function fail(message: string, field?: string): never {
    throw new Error(field ? `Field "${field}": ${message}` : message);
}

function asStringArray(value: unknown, fieldName: string, defaultValue: string[], minItems: number, maxItems: number): string[] {
    if (value === undefined || value === null) return [...defaultValue];
    if (!Array.isArray(value)) fail('must be an array of strings.', fieldName);

    const result = value.map((item) => {
        if (typeof item !== 'string') fail('all items must be strings.', fieldName);
        const trimmed = item.trim();
        if (!trimmed) fail('items must not be empty.', fieldName);
        return trimmed;
    });

    if (result.length < minItems) fail(`must contain at least ${minItems} item(s).`, fieldName);
    if (result.length > maxItems) fail(`must contain at most ${maxItems} items.`, fieldName);
    return [...new Set(result)];
}

function asIntInRange(value: unknown, fieldName: string, defaultValue: number, min: number, max: number): number {
    if (value === undefined || value === null || value === '') return defaultValue;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) fail('must be a number.', fieldName);
    if (!Number.isInteger(parsed)) fail('must be an integer.', fieldName);
    if (parsed < min || parsed > max) fail(`must be between ${min} and ${max}.`, fieldName);
    return parsed;
}

function asString(value: unknown, fieldName: string, defaultValue: string): string {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value !== 'string') fail('must be a string.', fieldName);
    return value.trim();
}

function asBoolean(value: unknown, fieldName: string, defaultValue: boolean): boolean {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value !== 'boolean') fail('must be true or false.', fieldName);
    return value;
}

function asProxyConfiguration(value: unknown): ProxyInput | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) fail('must be a proxy configuration object.', 'proxyConfiguration');
    return value as ProxyInput;
}

export function normalizeInput(raw: ActorInput = {}): NormalizedInput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Input must be a JSON object.');

    const watchlistName = asString(raw.watchlistName, 'watchlistName', 'shopify-us-watchlist');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(watchlistName)) fail('use 1–80 letters, digits, hyphens or underscores.', 'watchlistName');
    const storeCurrency = asString(raw.storeCurrency, 'storeCurrency', '').toUpperCase();
    if (storeCurrency && !/^[A-Z]{3}$/.test(storeCurrency)) fail('must be a three-letter currency code or empty.', 'storeCurrency');
    const productType = asString(raw.productType, 'productType', '').toLowerCase();
    if (productType.length > 200) fail('must be at most 200 characters.', 'productType');

    return {
        storeUrls: asStringArray(raw.storeUrls, 'storeUrls', [OFFICIAL_DEMO_HOST], 1, 5),
        maxProductsPerStore: asIntInRange(raw.maxProductsPerStore, 'maxProductsPerStore', DEFAULT_MAX_PRODUCTS_PER_STORE, 1, MAX_PRODUCTS_PER_STORE),
        productType,
        confirmAuthorizedUse: asBoolean(raw.confirmAuthorizedUse, 'confirmAuthorizedUse', false),
        trackChanges: asBoolean(raw.trackChanges, 'trackChanges', false),
        watchlistName,
        maxHistoryPoints: asIntInRange(raw.maxHistoryPoints, 'maxHistoryPoints', 10, 2, 30),
        storeCurrency,
        proxyConfiguration: asProxyConfiguration(raw.proxyConfiguration),
    };
}
