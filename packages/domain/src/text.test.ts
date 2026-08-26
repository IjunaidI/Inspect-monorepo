import { describe, expect, test } from 'vitest';
import { initialsFrom } from './text';

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
