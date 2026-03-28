import { describe, it, expect } from 'vitest';
import { apiUrl, wsUrl } from './urls';

describe('apiUrl', () => {
  it('returns absolute URLs unchanged', () => {
    expect(apiUrl('https://cdn.example.com/file.png')).toBe('https://cdn.example.com/file.png');
  });

  it('preserves non-http protocols as absolute', () => {
    expect(apiUrl('ftp://files.example.com/data')).toBe('ftp://files.example.com/data');
  });

  it('prepends /api to path with leading slash', () => {
    expect(apiUrl('/workspaces')).toBe('/api/workspaces');
  });

  it('prepends /api and adds leading slash to bare paths', () => {
    expect(apiUrl('workspaces')).toBe('/api/workspaces');
  });

  it('preserves query strings', () => {
    expect(apiUrl('/messages?limit=20')).toBe('/api/messages?limit=20');
  });
});

describe('wsUrl', () => {
  it('builds ws:// URL from current host with /api prefix', () => {
    const expected = `ws://${window.location.host}/api/ws/events`;
    expect(wsUrl('/ws/events')).toBe(expected);
  });

  it('adds leading slash to bare paths', () => {
    const expected = `ws://${window.location.host}/api/ws/events`;
    expect(wsUrl('ws/events')).toBe(expected);
  });
});
