import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-28T10:12:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function loadModule() {
  return await import('./agentStatus.js');
}

describe('agentStatus store', () => {
  it('stores the status fields and timestamp', async () => {
    const { setAgentStatus, getAgentStatus } = await loadModule();

    const status = setAgentStatus('u1', 'Writing tests', {
      progress: 0.5,
      eta: '2m',
    });

    expect(status).toEqual({
      text: 'Writing tests',
      progress: 0.5,
      eta: '2m',
      setAt: Date.parse('2026-03-28T10:12:00.000Z'),
    });
    expect(getAgentStatus('u1')).toEqual(status);
  });

  it('autoclears a status and invokes the clear callback', async () => {
    const { setAgentStatus, getAgentStatus } = await loadModule();
    const onClear = vi.fn();

    setAgentStatus('u1', 'Temporary status', { autoclear: '30s' }, onClear);

    vi.advanceTimersByTime(29_999);
    expect(getAgentStatus('u1')).toEqual({
      text: 'Temporary status',
      setAt: Date.parse('2026-03-28T10:12:00.000Z'),
    });
    expect(onClear).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(getAgentStatus('u1')).toBeUndefined();
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledWith('u1');
  });

  it('replaces any existing autoclear timer when status changes', async () => {
    const { setAgentStatus, getAgentStatus } = await loadModule();

    setAgentStatus('u1', 'First', { autoclear: '10s' });
    vi.advanceTimersByTime(5_000);
    setAgentStatus('u1', 'Second', { autoclear: '10s' });

    vi.advanceTimersByTime(9_999);
    expect(getAgentStatus('u1')).toEqual({
      text: 'Second',
      setAt: Date.parse('2026-03-28T10:12:05.000Z'),
    });

    vi.advanceTimersByTime(1);
    expect(getAgentStatus('u1')).toBeUndefined();
  });

  it('returns a snapshot from getAllStatuses instead of a live map', async () => {
    const { setAgentStatus, getAgentStatus, getAllStatuses } = await loadModule();

    setAgentStatus('u1', 'Visible to callers');
    const snapshot = getAllStatuses();

    snapshot.delete('u1');

    expect(snapshot.has('u1')).toBe(false);
    expect(getAgentStatus('u1')).toEqual({
      text: 'Visible to callers',
      setAt: Date.parse('2026-03-28T10:12:00.000Z'),
    });
  });

  it('clears an active status and cancels its timer', async () => {
    const { setAgentStatus, clearAgentStatus, getAgentStatus } = await loadModule();

    setAgentStatus('u1', 'Clearing soon', { autoclear: '1m' });
    expect(clearAgentStatus('u1')).toBe(true);
    expect(getAgentStatus('u1')).toBeUndefined();

    vi.advanceTimersByTime(60_000);
    expect(getAgentStatus('u1')).toBeUndefined();
    expect(clearAgentStatus('u1')).toBe(false);
  });
});
