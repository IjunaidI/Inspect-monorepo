import {
  ALLOWED_AQL_VALUES,
  formatAllowedAqlValues,
  InvalidAqlPlanError,
  resolveAqlPlan,
} from './aql-plan-input';

describe('ALLOWED_AQL_VALUES (INS-063)', () => {
  it('is exactly the verified MVP band plus the critical Ac0 case', () => {
    expect([...ALLOWED_AQL_VALUES]).toEqual([0, 1.0, 1.5, 2.5, 4.0, 6.5]);
  });

  it('formats the values for an error message a QA Manager can act on', () => {
    expect(formatAllowedAqlValues()).toBe('0, 1.0, 1.5, 2.5, 4.0, 6.5');
  });
});

describe('resolveAqlPlan', () => {
  it('resolves an omitted plan to the spec defaults (critical 0, major 2.5, minor 4.0)', () => {
    expect(resolveAqlPlan(undefined)).toEqual({ critical: 0, major: 2.5, minor: 4.0 });
    expect(resolveAqlPlan({})).toEqual({ critical: 0, major: 2.5, minor: 4.0 });
  });

  it('keeps the caller values and fills only the omitted classes', () => {
    expect(resolveAqlPlan({ major: 1.5 })).toEqual({ critical: 0, major: 1.5, minor: 4.0 });
    expect(resolveAqlPlan({ critical: 1.0, major: 6.5, minor: 6.5 })).toEqual({
      critical: 1.0,
      major: 6.5,
      minor: 6.5,
    });
  });

  it('accepts numeric strings (query-string preview params)', () => {
    expect(resolveAqlPlan({ major: '1.5' })).toEqual({ critical: 0, major: 1.5, minor: 4.0 });
  });

  it('rejects an out-of-band value, naming the allowed set', () => {
    expect(() => resolveAqlPlan({ major: 3.0 })).toThrow(InvalidAqlPlanError);
    expect(() => resolveAqlPlan({ major: 3.0 })).toThrow(/aqlPlan\.major must be one of 0, 1\.0, 1\.5, 2\.5, 4\.0, 6\.5/);
  });

  const junk: unknown[] = ['', '  ', 'abc', Number.NaN, true, {}, -1, 10];
  it.each(junk.map((v) => [v]))(
    'rejects the junk value %p instead of coercing it to 0 ("any defect rejects")',
    (value: unknown) => {
      expect(() => resolveAqlPlan({ minor: value })).toThrow(InvalidAqlPlanError);
    },
  );

  it('treats an explicit null as "not configured", not as 0', () => {
    expect(resolveAqlPlan({ major: null })).toEqual({ critical: 0, major: 2.5, minor: 4.0 });
  });

  it('does not mutate the caller input or the shared defaults', () => {
    const input = { major: 1.5 };
    const first = resolveAqlPlan(input);
    first.minor = 6.5;
    expect(input).toEqual({ major: 1.5 });
    expect(resolveAqlPlan({})).toEqual({ critical: 0, major: 2.5, minor: 4.0 });
  });
});
