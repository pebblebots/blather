import { describe, expect, it } from 'vitest';

// Simulate the temporal guard logic
function shouldRejectStaleData(
  incomingAsOfDate: string | undefined | null,
  existingAsOfDate: string | undefined | null
): boolean {
  if (!incomingAsOfDate) {
    // No as_of date in incoming data - allow update (manual update)
    return false;
  }
  
  if (!existingAsOfDate) {
    // No existing as_of date - allow update
    return false;
  }
  
  const incomingDate = new Date(incomingAsOfDate);
  const existingDate = new Date(existingAsOfDate);
  
  // Reject if incoming data is older than existing data
  return incomingDate < existingDate;
}

describe('temporal guard logic', () => {
  it('allows newer data to overwrite older data', () => {
    const shouldReject = shouldRejectStaleData('2024-02-15', '2024-01-15');
    expect(shouldReject).toBe(false);
  });

  it('rejects stale data from overwriting newer data', () => {
    const shouldReject = shouldRejectStaleData('2024-01-15', '2024-02-15');
    expect(shouldReject).toBe(true);
  });

  it('allows update when no existing as_of date', () => {
    const shouldReject = shouldRejectStaleData('2024-02-15', null);
    expect(shouldReject).toBe(false);
  });

  it('allows update when incoming data has no as_of date', () => {
    const shouldReject = shouldRejectStaleData(null, '2024-01-15');
    expect(shouldReject).toBe(false);
  });

  it('allows update when both dates are null', () => {
    const shouldReject = shouldRejectStaleData(null, null);
    expect(shouldReject).toBe(false);
  });

  it('handles same dates correctly', () => {
    const shouldReject = shouldRejectStaleData('2024-01-15', '2024-01-15');
    expect(shouldReject).toBe(false); // Allow updates with same date
  });
});