import { describe, expect, it } from 'vitest';
import { formatRelative, safeUrl } from './format.js';

describe('safeUrl', () => {
  it('allows https and same-origin relative paths', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('/inbox/42')).toBe('/inbox/42');
  });

  it('rejects script, data and protocol-relative URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('//evil.example.com')).toBeNull();
    expect(safeUrl('http://insecure.example.com')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe('formatRelative', () => {
  it('renders a relative time and degrades gracefully', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    expect(formatRelative('2026-01-01T11:59:30.000Z', now)).toMatch(/minute|second/);
    expect(formatRelative('not-a-date', now)).toBe('');
  });
});
