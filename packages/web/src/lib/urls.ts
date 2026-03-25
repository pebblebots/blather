const DEFAULT_DEV_API_URL = 'http://localhost:3000';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeConfiguredApiUrl(rawValue: string): string {
  const value = rawValue.trim();
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
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

export function apiUrl(path: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

export function wsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (API_BASE_URL) {
    const base = new URL(API_BASE_URL);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${base.host}${normalizedPath}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalizedPath}`;
}