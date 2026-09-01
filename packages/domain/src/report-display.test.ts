import { describe, expect, it } from 'vitest';

import { conclusionFrom, formatGps, formatInspectionType } from './report-display';

describe('conclusionFrom', () => {
  it('maps the three recorded decisions', () => {
    expect(conclusionFrom('PASS')).toBe('pass');
    expect(conclusionFrom('FAIL')).toBe('fail');
    expect(conclusionFrom('HOLD')).toBe('hold');
  });

  it('never fabricates a verdict — absent/unknown is pending (INS-056)', () => {
    expect(conclusionFrom(null)).toBe('pending');
    expect(conclusionFrom(undefined)).toBe('pending');
    expect(conclusionFrom('APPROVED')).toBe('pending');
    expect(conclusionFrom('')).toBe('pending');
  });
});

describe('formatInspectionType', () => {
  it('humanizes the Prisma enum', () => {
    expect(formatInspectionType('PRE_SHIPMENT')).toBe('Pre shipment');
    expect(formatInspectionType('INLINE')).toBe('Inline');
  });

  it('renders an em-dash for missing values', () => {
    expect(formatInspectionType(undefined)).toBe('—');
    expect(formatInspectionType(null)).toBe('—');
  });
});

describe('formatGps', () => {
  it('renders "lat, lng" when both keys exist', () => {
    expect(formatGps({ lat: 23.81, lng: 90.41 })).toBe('23.81, 90.41');
  });

  it('returns null for anything else', () => {
    expect(formatGps(null)).toBeNull();
    expect(formatGps({})).toBeNull();
    expect(formatGps({ lat: 1 })).toBeNull();
    expect(formatGps('23,90')).toBeNull();
  });
});
