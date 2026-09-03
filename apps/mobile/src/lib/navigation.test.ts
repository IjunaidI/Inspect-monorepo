import { describe, expect, it } from 'vitest';

import { HOME_HREF, resolveBack } from './navigation';

describe('resolveBack', () => {
  it('pops the stack when there is history', () => {
    expect(resolveBack(true)).toEqual({ kind: 'back' });
    expect(resolveBack(true, '/dashboard')).toEqual({ kind: 'back' });
  });

  it('replaces with the fallback when the screen is the stack root', () => {
    expect(resolveBack(false, '/dashboard')).toEqual({
      kind: 'replace',
      href: '/dashboard',
    });
  });

  it('falls back to the home screen when no fallback is given', () => {
    expect(resolveBack(false)).toEqual({ kind: 'replace', href: HOME_HREF });
  });
});
