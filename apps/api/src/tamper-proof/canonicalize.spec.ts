import { canonicalize } from './canonicalize';

describe('canonicalize', () => {
  it('is independent of object key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('sorts keys recursively in nested objects', () => {
    expect(canonicalize({ a: { y: 1, x: 2 } })).toBe(
      canonicalize({ a: { x: 2, y: 1 } }),
    );
  });

  it('preserves array order (arrays are sequences, not sets)', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('serializes primitives and null', () => {
    expect(canonicalize(5)).toBe('5');
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
  });

  it('produces a stable, deterministic string', () => {
    const obj = { z: [3, { q: 1, p: 2 }], a: 'hello' };
    expect(canonicalize(obj)).toBe(canonicalize(structuredClone(obj)));
  });
});
