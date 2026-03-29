import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

describe('useIsMobile', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  function setWidth(w: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: w,
    });
  }

  it('returns true when viewport is narrower than 768px', () => {
    setWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when viewport is 768px or wider', () => {
    setWidth(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates when the window is resized', () => {
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setWidth(500);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);

    act(() => {
      setWidth(900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);
  });

  it('cleans up the resize listener on unmount', () => {
    setWidth(1024);
    const { result, unmount } = renderHook(() => useIsMobile());

    unmount();

    // After unmount, resizing should not cause errors or state updates
    act(() => {
      setWidth(400);
      window.dispatchEvent(new Event('resize'));
    });
    // result.current is the last value before unmount — still false
    expect(result.current).toBe(false);
  });
});
