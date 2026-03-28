import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('iOS PWA safe-area support (T#69, T#70)', () => {
  const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
  const indexCss = readFileSync(resolve(__dirname, 'index.css'), 'utf-8');

  it('viewport meta tag includes viewport-fit=cover', () => {
    expect(indexHtml).toContain('viewport-fit=cover');
  });

  it('CSS includes safe-area-inset-bottom for message input (T#69)', () => {
    expect(indexCss).toContain('env(safe-area-inset-bottom');
    expect(indexCss).toContain('.safe-area-bottom');
  });

  it('CSS includes safe-area-inset-top for menu bar (T#70)', () => {
    expect(indexCss).toContain('env(safe-area-inset-top');
    expect(indexCss).toContain('.mac-menubar');
  });

  it('safe-area rules are wrapped in @supports for graceful degradation', () => {
    expect(indexCss).toContain('@supports (padding-top: env(safe-area-inset-top))');
  });
});
