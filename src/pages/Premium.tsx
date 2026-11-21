import { useState } from 'react';
import { Field, Loading, check, must, useApp, useLoad, useRun } from '../ui.tsx';

interface P { id: string; email: string | null; display_name: string | null; premium_until: string | null; premium_lifetime: boolean }
interface Sale { sale_id: string; status: string; expected_amount: number; expected_currency: string; created_at: string; completed_at: string | null; profiles: { email: string | null; display_name: string | null } | null }
interface Alert { id: number; kind: string; message: string; sale_id: string | null; created_at: string }
interface Sync { name?: string; type?: string; status?: string; price?: number; currency?: string; days?: number; warnings?: string[] }

const UNITS = { day: 'jour(s)', week: 'semaine(s)', month: 'mois', year: 'an(s)', lifetime: 'À vie' } as const;
type Unit = keyof typeof UNITS;
const PROVIDERS = { off: 'Fermé (Premium indisponible)', chariow: 'Chariow (Mobile Money)', momo: 'MTN MoMo direct' } as const;
type Provider = keyof typeof PROVIDERS;
const STATUS_FR: Record<string, string> = { awaiting_payment: 'En attente', completed: 'Payé', failed: 'Échoué', abandoned: 'Abandonné', mismatch: 'À examiner' };
const status = (p: P) => (p.premium_lifetime ? 'Premium à vie' : p.premium_until && Date.parse(p.premium_until) > Date.now() ? `Premium jusqu'au ${new Date(p.premium_until).toLocaleDateString('fr-FR')}` : null);
const when = (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Message renvoyé par une fonction du serveur (le texte générique de la bibliothèque est inutile). */
async function fnError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  try { const j = await ctx?.json(); if (j?.error) return String(j.error); } catch { /* corps illisible */ }
  return error instanceof Error ? error.message : 'Erreur';
}

function Payments() {
  const { sb } = useApp();
  const { run } = useRun();
  const provider = useLoad(async () => {
    const r = await sb.from('app_settings').select('value').eq('key', 'premium_provider').maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return ((r.data?.value as string | undefined) ?? 'off') as Provider;
  }, []);
  const offer = useLoad(async () => {
    const r = await sb.rpc('premium_offer');
    if (r.error) throw new Error(r.error.message);
    return ((r.data as { plan_id: string; label: string; days: number; price: number; currency: string }[] | null) ?? [])[0] ?? null;
  }, []);
  const sales = useLoad(async () => (must(await sb.from('chariow_sales').select('sale_id,status,expected_amount,expected_currency,created_at,completed_at,profiles(email,display_name)').order('created_at', { ascending: false }).limit(50)) as unknown as Sale[] | null) ?? [], []);
  const alerts = useLoad(async () => (must(await sb.from('chariow_alerts').select('id,kind,message,sale_id,created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(30)) as Alert[] | null) ?? [], []);
  const [info, setInfo] = useState<Sync | null>(null);

  const setProvider = (v: Provider) => run(async () => {
    check(await sb.from('app_settings').upsert({ key: 'premium_provider', value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
    provider.reload();
  }, 'Moyen de paiement enregistré');
  const sync = () => run(async () => {
    const r = await sb.functions.invoke('chariow-sync');
    if (r.error) throw new Error(await fnError(r.error));
    setInfo(r.data as Sync);
    offer.reload();
  }, 'Prix relevé chez Chariow');
  const resolve = (a: Alert) => run(async () => { check(await sb.from('chariow_alerts').update({ resolved: true }).eq('id', a.id)); alerts.reload(); }, 'Alerte classée');

  return (
    <>
      <div className="card">
        <Field label="Moyen de paiement ouvert aux utilisateurs">
          <select value={provider.data ?? 'off'} onChange={(e) => void setProvider(e.target.value as Provider)}>
            {(Object.keys(PROVIDERS) as Provider[]).map((k) => <option key={k} value={k}>{PROVIDERS[k]}</option>)}
          </select>
        </Field>
        <p className="muted">« Fermé » est le réglage sûr tant que Chariow n'est pas configuré. Les attributions manuelles ci-dessous marchent toujours.</p>
      </div>

      <h2>Offre Chariow</h2>
      <div className="card">
        {offer.data?.price ? <p><b>{offer.data.label}</b> : {offer.data.price} {offer.data.currency} pour {offer.data.days} jours (prix affiché dans l'application)</p> : <p className="muted">Offre non relevée pour le moment.</p>}
        <p className="muted">Le prix se modifie dans Chariow : Balade le relit à chaque achat. Ce bouton le relève tout de suite et vérifie le produit.</p>
        <button className="primary" onClick={() => void sync()}>Synchroniser avec Chariow</button>
        {info && (
          <div>
            <p><b>{info.name}</b> · type {info.type} · {info.status} · {info.price} {info.currency}</p>
            {(info.warnings ?? []).length === 0 ? <p className="muted">Aucun problème détecté.</p> : (info.warnings ?? []).map((w) => <p key={w} className="muted">⚠ {w}</p>)}
          </div>
        )}
      </div>

      <h2>Anomalies à examiner ({(alerts.data ?? []).length})</h2>
      <div className="card">
        {(alerts.data ?? []).length === 0 && <p className="muted">Aucune anomalie.</p>}
        {(alerts.data ?? []).map((a) => (
          <div className="item" key={a.id}>
            <div><b>{a.kind}</b> <span className="muted">{when(a.created_at)}</span><div className="muted">{a.message}</div></div>
            <button onClick={() => void resolve(a)}>Classer</button>
          </div>
        ))}
      </div>

      <h2>Paiements Chariow</h2>
      <Loading s={sales} />
      <div className="card">
        {(sales.data ?? []).length === 0 && <p className="muted">Aucun paiement pour l'instant.</p>}
        {(sales.data ?? []).map((s) => (
          <div className="item" key={s.sale_id}>
            <div>
              <b>{s.profiles?.display_name ?? '—'}</b> <span className="muted">{s.profiles?.email ?? ''}</span>
              <div className="muted">{when(s.created_at)} · {s.expected_amount} {s.expected_currency} · {s.sale_id}</div>
            </div>
            <span className={s.status === 'completed' ? '' : 'muted'}>{STATUS_FR[s.status] ?? s.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function Premium() {
  const { sb } = useApp();
  const list = useLoad(async () => (must(await sb.from('profiles').select('id,email,display_name,premium_until,premium_lifetime').order('created_at', { ascending: false }).limit(300)) as P[] | null) ?? [], []);
  const { run } = useRun();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<Unit>('month');
  const all = list.data ?? [];
  const term = q.trim().toLowerCase();
  const found = term ? all.filter((u) => `${u.email ?? ''} ${u.display_name ?? ''}`.toLowerCase().includes(term)).slice(0, 8) : [];
  const chosen = all.find((u) => u.id === sel);
  const actives = all.filter((u) => status(u));
  const give = () => run(async () => {
    if (!sel) throw new Error('Choisissez un compte.');
    const n = Number(amount);
    if (unit !== 'lifetime' && !(Number.isInteger(n) && n >= 1 && n <= 1000)) throw new Error('Quantité : un nombre entier de 1 à 1000.');
    check(await sb.rpc('admin_grant_premium', { p_user: sel, p_unit: unit, p_amount: unit === 'lifetime' ? 1 : n }));
    list.reload();
  }, 'Premium accordé');
  const revoke = (u: P) => {
    if (!window.confirm(`Retirer le Premium de ${u.display_name ?? u.email ?? 'ce compte'} ?`)) return;
    void run(async () => { check(await sb.rpc('admin_revoke_premium', { p_user: u.id })); list.reload(); }, 'Premium retiré');
  };
  return (
    <>
      <h1>Premium</h1>
      <Payments />
      <h2>Offrir Premium à la main</h2>
      <Loading s={list} />
      <div className="card">
        <Field label="1. Chercher un compte (e-mail ou pseudo)"><input value={q} onChange={(e) => { setQ(e.target.value); setSel(''); }} placeholder="ex. marie@gmail.com" /></Field>
        {found.map((u) => (
          <div className="item" key={u.id}>
            <div><b>{u.display_name ?? '—'}</b> <span className="muted">{u.email ?? ''}</span>{status(u) && <div className="muted">{status(u)}</div>}</div>
            <button className={sel === u.id ? 'primary' : ''} onClick={() => setSel(u.id)}>{sel === u.id ? 'Choisi' : 'Choisir'}</button>
          </div>
        ))}
        {chosen && (
          <div className="row">
            <Field label={`2. Durée offerte à ${chosen.display_name ?? chosen.email}`}>
              <input inputMode="numeric" value={unit === 'lifetime' ? '' : amount} disabled={unit === 'lifetime'} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Unité"><select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{(Object.keys(UNITS) as Unit[]).map((k) => <option key={k} value={k}>{UNITS[k]}</option>)}</select></Field>
            <button className="primary" onClick={() => void give()}>Offrir Premium</button>
          </div>
        )}
      </div>
      <h2>Comptes Premium ({actives.length})</h2>
      <div className="card">
        {actives.length === 0 && <p className="muted">Aucun compte Premium pour l'instant.</p>}
        {actives.map((u) => (
          <div className="item" key={u.id}>
            <div><b>{u.display_name ?? '—'}</b> <span className="muted">{u.email ?? ''}</span><div className="muted">{status(u)}</div></div>
            <button className="danger" onClick={() => revoke(u)}>Retirer</button>
          </div>
        ))}
      </div>
      <p className="muted">La durée offerte s'ajoute à un Premium déjà en cours. Les paiements Chariow activent Premium automatiquement, après vérification de la vente par le serveur.</p>
    </>
  );
}
