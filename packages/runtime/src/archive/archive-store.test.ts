/**
 * assertValidRetentionUntil (ROADMAP Stage 3, "Archive store ... DoD:
 * archiving without retention fails"). This is the core proof required by
 * the task: every path that should reject a missing/invalid retentionUntil
 * does, before any archive backend gets involved.
 */
import { describe, expect, it } from 'vitest';
import { assertValidRetentionUntil } from './archive-store.js';

describe('assertValidRetentionUntil', () => {
  it('returns the value back for a valid RFC 3339 timestamp', () => {
    expect(assertValidRetentionUntil('2030-01-01T00:00:00Z')).toBe('2030-01-01T00:00:00Z');
    expect(assertValidRetentionUntil('2030-01-01T00:00:00.123Z')).toBe('2030-01-01T00:00:00.123Z');
    expect(assertValidRetentionUntil('2030-01-01T00:00:00+02:00')).toBe('2030-01-01T00:00:00+02:00');
  });

  it('throws for undefined', () => {
    expect(() => assertValidRetentionUntil(undefined)).toThrow(TypeError);
  });

  it('throws for null', () => {
    expect(() => assertValidRetentionUntil(null)).toThrow(TypeError);
  });

  it('throws for an empty string', () => {
    expect(() => assertValidRetentionUntil('')).toThrow(TypeError);
  });

  it('throws for a non-string value', () => {
    expect(() => assertValidRetentionUntil(12345)).toThrow(TypeError);
    expect(() => assertValidRetentionUntil({})).toThrow(TypeError);
  });

  it('throws for a date-only string (not a full RFC 3339 timestamp)', () => {
    expect(() => assertValidRetentionUntil('2030-01-01')).toThrow(TypeError);
  });

  it('throws for garbage text', () => {
    expect(() => assertValidRetentionUntil('not-a-date')).toThrow(TypeError);
  });

  it('throws for a syntactically-shaped but impossible date', () => {
    expect(() => assertValidRetentionUntil('2030-13-40T99:99:99Z')).toThrow(TypeError);
  });
});
