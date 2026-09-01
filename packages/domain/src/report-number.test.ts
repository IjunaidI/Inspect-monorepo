import { describe, expect, it } from 'vitest';

import { reportNumber } from './report-number';

describe('reportNumber', () => {
  it('derives IR- + first 8 chars, uppercased', () => {
    expect(reportNumber('cmtgfhx9abcdef')).toBe('IR-CMTGFHX9');
  });

  it('never exceeds 8 id chars even for long ids', () => {
    expect(reportNumber('0123456789abcdef')).toBe('IR-01234567');
  });
});
