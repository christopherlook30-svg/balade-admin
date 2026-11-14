export type PeriodKind = '7d' | '30d' | '90d' | 'month' | 'lastmonth';
export interface Range { from: string; to: string }
export interface Period { label: string; cur: Range; prev: Range; days: number }

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

/** today : date du jour au format AAAA-MM-JJ. Les périodes précédentes servent aux comparaisons. */
export function periodRange(kind: PeriodKind, today: string): Period {
  const t = new Date(`${today}T00:00:00Z`);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  if (kind === '7d' || kind === '30d' || kind === '90d') {
    const n = kind === '7d' ? 7 : kind === '30d' ? 30 : 90;
    const from = addDays(t, -(n - 1));
    return { label: `${n} derniers jours`, days: n, cur: { from: iso(from), to: today }, prev: { from: iso(addDays(from, -n)), to: iso(addDays(from, -1)) } };
  }
  if (kind === 'month') {
    const from = utc(y, m, 1);
    const days = diffDays(from, t) + 1;
    const pFrom = utc(y, m - 1, 1);
    const pEnd = addDays(from, -1);
    const pTo = addDays(pFrom, days - 1);
    return { label: 'Ce mois-ci', days, cur: { from: iso(from), to: today }, prev: { from: iso(pFrom), to: iso(pTo > pEnd ? pEnd : pTo) } };
  }
  const from = utc(y, m - 1, 1);
  const to = utc(y, m, 0);
  const pFrom = utc(y, m - 2, 1);
  return { label: 'Mois dernier', days: diffDays(from, to) + 1, cur: { from: iso(from), to: iso(to) }, prev: { from: iso(pFrom), to: iso(utc(y, m - 1, 0)) } };
}

/** Évolution en pourcentage par rapport à la période précédente (« — » si la base est nulle). */
export function delta(cur: number, prev: number): string {
  if (!(prev > 0)) return cur > 0 ? 'nouveau' : '—';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p > 0 ? '+' : ''}${p} %`;
}
export function ctr(clicks: number, impressions: number): string {
  return impressions > 0 ? `${((clicks / impressions) * 100).toFixed(1).replace('.', ',')} %` : '—';
}
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** Export CSV simple d'une liste de lignes (annonceurs, comptabilité). */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c) : q(c))).join(';')).join('\n');
}
