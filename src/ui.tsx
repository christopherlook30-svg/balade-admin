import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from './lib/permissions.ts';

export interface Profile { id: string; email: string | null; display_name: string | null; role: Role }
export interface AppCtx { sb: SupabaseClient; profile: Profile; toast: (text: string, bad?: boolean) => void }
export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('Contexte absent');
  return c;
}

export function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
export function check(r: { error: { message: string } | null }): void {
  if (r.error) throw new Error(r.error.message);
}
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true }));
    fn().then((d) => { if (alive) set({ data: d, error: null, loading: false }); })
      .catch((e: unknown) => { if (alive) set({ data: null, error: errText(e), loading: false }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Exécute une action avec message de réussite ou d'erreur. */
export function useRun() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok = 'Enregistré') => {
    setBusy(true);
    try { await fn(); toast(ok); return true; } catch (e) { toast(errText(e), true); return false; } finally { setBusy(false); }
  };
  return { run, busy };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label>{label}</label>{children}</div>;
}
export function Errors({ list }: { list: string[] }) {
  return list.length ? <div className="err">{list.map((m) => <div key={m}>• {m}</div>)}</div> : null;
}
export function Loading({ s }: { s: { loading: boolean; error: string | null } }) {
  if (s.loading) return <p className="muted">Chargement…</p>;
  if (s.error) return <p className="err">Erreur : {s.error}</p>;
  return null;
}
export const fmtDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
