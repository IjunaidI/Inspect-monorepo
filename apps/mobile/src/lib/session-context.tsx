/**
 * The session as React state (INS-095). `session.ts` still OWNS the credentials
 * (SecureStore) and the API client; this module only mirrors "is someone signed
 * in, and who" into a context so the root layout's `Stack.Protected` guard and
 * the tab bar's role gate can read it before first paint.
 *
 * It learns about changes through `subscribeSession()` — every existing
 * `signIn()` / `signOut()` call anywhere in the app flips the guard without
 * touching those call sites.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { hasSession, loadIdentity, subscribeSession, type Identity } from './session';

export type SessionState = 'loading' | 'in' | 'out';

export interface SessionValue {
  state: SessionState;
  identity: Identity | null;
  /** Re-read SecureStore (e.g. after an identity change). */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function readSession(): Promise<{ state: SessionState; identity: Identity | null }> {
  const ok = await hasSession();
  if (!ok) return { state: 'out', identity: null };
  return { state: 'in', identity: await loadIdentity() };
}

/** Boots the session once and follows every later sign-in / sign-out. Root layout only. */
export function useSessionBoot(): SessionValue {
  const [snapshot, setSnapshot] = useState<{ state: SessionState; identity: Identity | null }>({
    state: 'loading',
    identity: null,
  });

  useEffect(() => {
    let alive = true;
    const sync = () => {
      readSession().then((next) => {
        if (alive) setSnapshot(next);
      });
    };
    sync();
    const unsubscribe = subscribeSession(sync);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return {
    state: snapshot.state,
    identity: snapshot.identity,
    refresh: async () => setSnapshot(await readSession()),
  };
}

export function SessionProvider({ value, children }: { value: SessionValue; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
