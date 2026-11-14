import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'auto';
const KEY = 'balade-admin:theme';
const dark = (p: ThemePref) => p === 'dark' || (p === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
const apply = (p: ThemePref) => { document.documentElement.dataset.theme = dark(p) ? 'dark' : 'light'; };

/** Thème A (clair) par défaut ; D (sombre doux) à la demande ; « auto » suit le téléphone. */
export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>(() => {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'auto' ? v : 'light';
  });
  useEffect(() => {
    apply(pref);
    localStorage.setItem(KEY, pref);
    if (pref !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => apply('auto');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [pref]);
  const next = () => setPref((p) => (p === 'light' ? 'dark' : p === 'dark' ? 'auto' : 'light'));
  return { pref, setPref, next };
}
