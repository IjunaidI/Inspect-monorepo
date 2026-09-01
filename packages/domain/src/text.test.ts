import { describe, expect, test } from 'vitest';
import { hashIndex, initialsFrom } from './text';

describe('initialsFrom', () => {
  test('takes the first letter of the first two words', () => {
    expect(initialsFrom('Jane Doe')).toBe('JD');
  });

  test('ignores the domain of an email address', () => {
    expect(initialsFrom('jane.doe@example.com')).toBe('JD');
  });

  test('treats dots, underscores, hyphens and spaces as separators', () => {
    expect(initialsFrom('jane_doe')).toBe('JD');
    expect(initialsFrom('jane-doe')).toBe('JD');
    expect(initialsFrom('jane.doe')).toBe('JD');
  });

  test('returns a single initial when there is only one word', () => {
    expect(initialsFrom('Jane')).toBe('J');
  });

  test('never returns an empty string', () => {
    // An empty avatar is a rendering hole; '?' is the deliberate floor.
    expect(initialsFrom('')).toBe('?');
  });
});

describe('hashIndex', () => {
  test('is deterministic and within range', () => {
    for (const key of ['a', 'company-1', 'cmtgfhx9', '']) {
      const i = hashIndex(key, 6);
      expect(i).toBe(hashIndex(key, 6));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });

  test('spreads distinct keys across buckets', () => {
    const seen = new Set(
      Array.from({ length: 50 }, (_, n) => hashIndex(`company-${n}`, 6)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  test('tolerates a nonsense bucket count', () => {
    expect(hashIndex('x', 0)).toBe(0);
  });
});
