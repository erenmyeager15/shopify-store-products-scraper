import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export const OFFICIAL_DEMO_HOST = 'demostore.mock.shop';

export interface ResolvedAddress {
    address: string;
    family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultResolver: HostResolver = async (hostname) => lookup(hostname, {
    all: true,
    verbatim: true,
});

function normalizedHostname(url: URL): string {
    return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isGloballyRoutable(address: string): boolean {
    const parsed = ipaddr.parse(address);
    const normalized = 'isIPv4MappedAddress' in parsed && parsed.isIPv4MappedAddress()
        ? parsed.toIPv4Address()
        : parsed;

    return normalized.range() === 'unicast';
}

export function normalizeStoreOrigin(raw: string): string {
    const value = raw.trim();
    if (!value) throw new Error('Store URL must not be empty.');

    const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    const hostname = normalizedHostname(url);

    if (url.protocol !== 'https:') {
        throw new Error(`Store URL must use HTTPS: ${raw}`);
    }
    if (url.username || url.password) {
        throw new Error(`Store URL must not include credentials: ${raw}`);
    }
    if (url.port) {
        throw new Error(`Store URL must not include a custom port: ${raw}`);
    }
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error(`Store URL must use a public hostname: ${raw}`);
    }
    if (isIP(hostname) && !isGloballyRoutable(hostname)) {
        throw new Error(`Store URL resolves to a non-public address: ${raw}`);
    }

    return `https://${hostname}`;
}

export function isOfficialDemoOrigin(origin: string): boolean {
    const hostname = normalizedHostname(new URL(origin));
    return hostname === OFFICIAL_DEMO_HOST;
}

export function assertAuthorizedUse(origins: string[], confirmed: boolean): void {
    const includesRealStore = origins.some((origin) => !isOfficialDemoOrigin(origin));
    if (includesRealStore && !confirmed) {
        throw new Error(
            'Confirm authorized use before scraping a real store. Use only stores you own, administer, or have permission to monitor.',
        );
    }
}

export async function assertPublicNetworkTarget(
    origin: string,
    resolver: HostResolver = defaultResolver,
): Promise<void> {
    const url = new URL(origin);
    const hostname = normalizedHostname(url);
    const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await resolver(hostname);

    if (addresses.length === 0) {
        throw new Error(`Store hostname did not resolve: ${hostname}`);
    }

    for (const { address } of addresses) {
        if (!ipaddr.isValid(address) || !isGloballyRoutable(address)) {
            throw new Error(`Store hostname resolves to a non-public address: ${hostname}`);
        }
    }
}
