import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateConfig } from './lib/validate.ts';

const KEY = 'balade-admin:config:v1';
export interface Config { url: string; anonKey: string }

/** Adresse et clé publique « anon » : variables de build, ou saisies une fois dans le navigateur. */
export function loadConfig(): Config | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey && !validateConfig(url, anonKey)) return { url, anonKey };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<Config>;
      if (typeof c.url === 'string' && typeof c.anonKey === 'string' && !validateConfig(c.url, c.anonKey)) return { url: c.url, anonKey: c.anonKey };
    }
  } catch { /* configuration illisible : on la redemande */ }
  return null;
}
export function saveConfig(c: Config): void { localStorage.setItem(KEY, JSON.stringify(c)); }
export function clearConfig(): void { localStorage.removeItem(KEY); }
export function makeClient(c: Config): SupabaseClient {
  return createClient(c.url.trim(), c.anonKey.trim(), { auth: { persistSession: true, autoRefreshToken: true } });
}
export const publicUrl = (sb: SupabaseClient, bucket: string, path: string): string => sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
