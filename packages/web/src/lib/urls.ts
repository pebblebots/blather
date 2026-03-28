/** Matches strings that already start with a protocol (e.g. "http://", "https://"). */
const HAS_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  if (HAS_PROTOCOL.test(path)) {
    return path;
  }
  return `/api${ensureLeadingSlash(path)}`;
}

export function wsUrl(path: string): string {
  const normalizedPath = `/api${ensureLeadingSlash(path)}`;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}${normalizedPath}`;
}
