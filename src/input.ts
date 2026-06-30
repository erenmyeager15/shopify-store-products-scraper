import type { ActorInput, ProxyInput } from './types.js';

export interface NormalizedInput {
    storeUrls: string[];
    maxProductsPerStore: number;
    productType: string;
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

function asProxyConfiguration(value: unknown): ProxyInput | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) fail('must be a proxy configuration object.', 'proxyConfiguration');
    return value as ProxyInput;
}

export function normalizeInput(raw: ActorInput = {}): NormalizedInput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Input must be a JSON object.');

    return {
        storeUrls: asStringArray(raw.storeUrls, 'storeUrls', ['allbirds.com'], 1, 5),
        maxProductsPerStore: asIntInRange(raw.maxProductsPerStore, 'maxProductsPerStore', DEFAULT_MAX_PRODUCTS_PER_STORE, 1, MAX_PRODUCTS_PER_STORE),
        productType: asString(raw.productType, 'productType', ''),
        proxyConfiguration: asProxyConfiguration(raw.proxyConfiguration),
    };
}
