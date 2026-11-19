import { useState } from 'react';
import { Field, Loading, check, must, useApp, useLoad, useRun } from '../ui.tsx';

interface P { id: string; email: string | null; display_name: string | null; premium_until: string | null; premium_lifetime: boolean }
const UNITS = { day: 'jour(s)', week: 'semaine(s)', month: 'mois', year: 'an(s)', lifetime: 'À vie' } as const;
type Unit = keyof typeof UNITS;
const status = (p: P) => (p.premium_lifetime ? 'Premium à vie' : p.premium_until && Date.parse(p.premium_until) > Date.now() ? `Premium jusqu'au ${new Date(p.premium_until).toLocaleDateString('fr-FR')}` : null);

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
      <p className="muted">La durée offerte s'ajoute à un Premium déjà en cours. Les paiements PawaPay activent Premium automatiquement.</p>
    </>
  );
}
