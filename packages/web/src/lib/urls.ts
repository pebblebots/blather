const DEFAULT_DEV_API_URL = 'http://localhost:3000';

/** Matches strings that already start with a protocol (e.g. "http://", "https://"). */
const HAS_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeConfiguredApiUrl(rawValue: string): string {
  const value = rawValue.trim();
  if (HAS_PROTOCOL.test(value)) {
    return trimTrailingSlash(value);
  }

  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? 'https://'
    : 'http://';

  return trimTrailingSlash(`${protocol}${value}`);
}

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    return normalizeConfiguredApiUrl(configured);
  }

  if (import.meta.env.DEV) {
    return DEFAULT_DEV_API_URL;
  }

  return '';
}

export const API_BASE_URL = resolveApiBaseUrl();

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  if (HAS_PROTOCOL.test(path)) {
    return path;
  }

  const normalizedPath = ensureLeadingSlash(path);
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

export function wsUrl(path: string): string {
  const normalizedPath = ensureLeadingSlash(path);

  if (API_BASE_URL) {
    const base = new URL(API_BASE_URL);
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${base.host}${normalizedPath}`;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}${normalizedPath}`;
}