import { parseListQuery } from './list-query';

describe('parseListQuery (INS-050)', () => {
  it('defaults to take 50, skip 0, no q', () => {
    expect(parseListQuery({})).toEqual({ take: 50, skip: 0, q: undefined });
  });

  it('clamps take to 1..100', () => {
    expect(parseListQuery({ take: '0' }).take).toBe(1);
    expect(parseListQuery({ take: '-5' }).take).toBe(1);
    expect(parseListQuery({ take: '999' }).take).toBe(100);
    expect(parseListQuery({ take: '25' }).take).toBe(25);
    expect(parseListQuery({ take: 'garbage' }).take).toBe(50);
  });

  it('clamps skip to >= 0', () => {
    expect(parseListQuery({ skip: '-10' }).skip).toBe(0);
    expect(parseListQuery({ skip: '100' }).skip).toBe(100);
    expect(parseListQuery({ skip: 'garbage' }).skip).toBe(0);
  });

  it('trims and length-caps q; empty becomes undefined', () => {
    expect(parseListQuery({ q: '  denim  ' }).q).toBe('denim');
    expect(parseListQuery({ q: '   ' }).q).toBeUndefined();
    expect(parseListQuery({ q: 'x'.repeat(500) }).q).toHaveLength(200);
  });

  it('coerces repeated/array/object params instead of throwing (500 guard)', () => {
    // Express delivers ?q=a&q=b as ['a','b'] — must not throw on .trim().
    expect(parseListQuery({ q: ['a', 'b'] }).q).toBe('a');
    expect(parseListQuery({ q: { x: 1 } }).q).toBeUndefined();
    expect(parseListQuery({ take: ['25', '9'] }).take).toBe(25);
    expect(parseListQuery({ skip: [] }).skip).toBe(0);
  });
});
