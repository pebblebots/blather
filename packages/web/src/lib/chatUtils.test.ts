import { describe, it, expect } from 'vitest';
import { getDisambiguatedNames } from './chatUtils';

describe('getDisambiguatedNames', () => {
  it('returns display names unchanged when all are unique', () => {
    const members = [
      { id: 'u-1', displayName: 'Alice', email: 'alice@example.com' },
      { id: 'u-2', displayName: 'Bob', email: 'bob@example.com' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('u-1')).toBe('Alice');
    expect(result.get('u-2')).toBe('Bob');
  });

  it('appends username prefix when display names collide but usernames differ', () => {
    const members = [
      { id: 'u-1', displayName: 'Nicole', email: 'nparker@pbd.bot' },
      { id: 'u-2', displayName: 'Nicole', email: 'nroberts@pebblebed.com' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('u-1')).toBe('Nicole (nparker)');
    expect(result.get('u-2')).toBe('Nicole (nroberts)');
  });

  it('T#133: falls back to domain suffix when display name AND username both collide', () => {
    // nicole@pbd.bot and nicole@pebblebed.com — same displayName "nicole", same username "nicole"
    const members = [
      { id: 'u-1', displayName: 'Nicole', email: 'nicole@pbd.bot' },
      { id: 'u-2', displayName: 'Nicole', email: 'nicole@pebblebed.com' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('u-1')).toBe('Nicole (pbd.bot)');
    expect(result.get('u-2')).toBe('Nicole (pebblebed.com)');
  });

  it('T#133: uses full email when display name, username AND domain all collide', () => {
    const members = [
      { id: 'u-1', displayName: 'Jenny', email: 'jenny@pbd.bot' },
      { id: 'u-2', displayName: 'Jenny', email: 'jenny@pbd.bot' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('u-1')).toBe('Jenny (jenny@pbd.bot)');
    expect(result.get('u-2')).toBe('Jenny (jenny@pbd.bot)');
  });

  it('falls back to short ID (first 6 chars) when display name collides and email is absent', () => {
    const members = [
      { id: 'abcdef123456', displayName: 'Bot' },
      { id: 'xyz789000000', displayName: 'Bot' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('abcdef123456')).toBe('Bot (abcdef)');
    expect(result.get('xyz789000000')).toBe('Bot (xyz789)');
  });

  it('does not affect non-duplicate members in a mixed list', () => {
    const members = [
      { id: 'u-1', displayName: 'Nicole', email: 'nicole@pbd.bot' },
      { id: 'u-2', displayName: 'Nicole', email: 'nicole@pebblebed.com' },
      { id: 'u-3', displayName: 'Alice', email: 'alice@pbd.bot' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('u-1')).toBe('Nicole (pbd.bot)');
    expect(result.get('u-2')).toBe('Nicole (pebblebed.com)');
    expect(result.get('u-3')).toBe('Alice');
  });

  it('handles three-way collision with distinct domains', () => {
    const members = [
      { id: 'u-1', displayName: 'Sam', email: 'sam@alpha.com' },
      { id: 'u-2', displayName: 'Sam', email: 'sam@beta.com' },
      { id: 'u-3', displayName: 'Sam', email: 'sam@gamma.com' },
    ];
    const result = getDisambiguatedNames(members);
    expect(result.get('u-1')).toBe('Sam (alpha.com)');
    expect(result.get('u-2')).toBe('Sam (beta.com)');
    expect(result.get('u-3')).toBe('Sam (gamma.com)');
  });
});
