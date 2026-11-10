import { useState } from 'react';
import { slugify } from '../lib/validate.ts';
import type { Role } from '../lib/permissions.ts';
import { Field, Loading, check, must, useApp, useLoad, useRun } from '../ui.tsx';

interface Cat { id: number; slug: string; label_fr: string; sort: number }
export function Categories() {
  const { sb } = useApp();
  const list = useLoad(async () => (must(await sb.from('categories').select('id,slug,label_fr,sort').order('sort')) as Cat[] | null) ?? [], []);
  const { run } = useRun();
  const [label, setLabel] = useState('');
  const add = () => run(async () => {
    const slug = slugify(label);
    if (!slug) throw new Error('Nom invalide.');
    check(await sb.from('categories').insert({ slug, label_fr: label.trim(), sort: (list.data?.length ?? 0) + 1 }));
    setLabel('');
    list.reload();
  }, 'Catégorie ajoutée');
  const rename = (c: Cat) => {
    const v = window.prompt('Nouveau nom', c.label_fr);
    if (v && v.trim()) void run(async () => { check(await sb.from('categories').update({ label_fr: v.trim() }).eq('id', c.id)); list.reload(); }, 'Catégorie renommée');
  };
  const del = (c: Cat) => run(async () => { check(await sb.from('categories').delete().eq('id', c.id)); list.reload(); }, 'Catégorie supprimée');
  return (
    <>
      <h1>Catégories</h1>
      <div className="card row"><Field label="Nouvelle catégorie"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field><button className="primary" onClick={() => void add()}>Ajouter</button></div>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).map((c) => (
          <div className="item" key={c.id}><div><b>{c.label_fr}</b> <span className="muted">({c.slug})</span></div><div className="row" style={{ flex: '0 0 auto' }}><button onClick={() => rename(c)}>Renommer</button><button className="danger" onClick={() => void del(c)}>Supprimer</button></div></div>
        ))}
      </div>
      <p className="muted">Une catégorie utilisée par des lieux ne peut pas être supprimée.</p>
    </>
  );
}

const SETTINGS: { key: string; label: string; kind: 'bool' | 'int'; help: string }[] = [
  { key: 'ads_enabled', label: 'Publicité activée', kind: 'bool', help: 'Interrupteur général : désactivé, plus aucune annonce n\'est montrée.' },
  { key: 'popup_max_per_day', label: 'Pop-ups par jour et par personne', kind: 'int', help: 'Recommandé : 1.' },
  { key: 'popup_grace_days', label: 'Jours sans pop-up après l\'installation', kind: 'int', help: 'Recommandé : 2.' },
  { key: 'popup_min_places_opened', label: 'Fiches ouvertes avant un pop-up', kind: 'int', help: 'Recommandé : 2.' },
  { key: 'banner_rotation_seconds', label: 'Rotation du bandeau (secondes)', kind: 'int', help: 'Recommandé : 10.' },
];
export function Settings() {
  const { sb } = useApp();
  const list = useLoad(async () => {
    const rows = (must(await sb.from('app_settings').select('key,value')) as { key: string; value: unknown }[] | null) ?? [];
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  }, []);
  const { run } = useRun();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const val = (k: string) => (k in draft ? draft[k] : list.data?.[k]);
  const save = () => run(async () => {
    for (const s of SETTINGS) {
      const v = val(s.key);
      if (v === undefined) continue;
      if (s.kind === 'int' && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1000)) throw new Error(`« ${s.label} » doit être un entier entre 0 et 1000.`);
      check(await sb.from('app_settings').upsert({ key: s.key, value: s.kind === 'int' ? Number(v) : Boolean(v), updated_at: new Date().toISOString() }, { onConflict: 'key' }));
    }
    setDraft({});
    list.reload();
  }, 'Réglages enregistrés');
  return (
    <>
      <h1>Réglages de la publicité</h1>
      <Loading s={list} />
      {list.data && (
        <div className="card">
          {SETTINGS.map((s) => (
            <div key={s.key}>
              {s.kind === 'bool'
                ? <label><input type="checkbox" style={{ width: 'auto' }} checked={Boolean(val(s.key))} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.checked })} /> <b>{s.label}</b></label>
                : <Field label={s.label}><input inputMode="numeric" value={String(val(s.key) ?? '')} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} /></Field>}
              <div className="muted">{s.help}</div>
            </div>
          ))}
          <p><button className="primary" onClick={() => void save()}>Enregistrer</button></p>
        </div>
      )}
    </>
  );
}

interface U { id: string; email: string | null; display_name: string | null; role: Role }
const ROLES: Record<Role, string> = { super_admin: 'Super administrateur', admin: 'Administrateur', moderator: 'Modérateur', creator: 'Créateur partenaire', user: 'Utilisateur (aucun accès)' };
export function Users() {
  const { sb, profile } = useApp();
  const [q, setQ] = useState('');
  const list = useLoad(async () => (must(await sb.from('profiles').select('id,email,display_name,role').order('created_at', { ascending: false }).limit(300)) as U[] | null) ?? [], []);
  const { run } = useRun();
  const change = (u: U, role: Role) => run(async () => { check(await sb.rpc('set_user_role', { p_user: u.id, p_role: role })); list.reload(); }, 'Rôle modifié');
  const shown = (list.data ?? []).filter((u) => !q || `${u.email ?? ''} ${u.display_name ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h1>Utilisateurs</h1>
      <input placeholder="Rechercher par e-mail ou nom…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Loading s={list} />
      <div className="card">
        {shown.map((u) => (
          <div className="item" key={u.id}>
            <div><b>{u.display_name ?? '—'}</b><div className="muted">{u.email ?? '—'}</div></div>
            <select value={u.role} disabled={u.id === profile.id} onChange={(e) => void change(u, e.target.value as Role)}>{(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}</select>
          </div>
        ))}
      </div>
      <p className="muted">Les nouveaux comptes apparaissent ici après leur inscription (rôle « Utilisateur »). Seul un super administrateur peut changer un rôle.</p>
    </>
  );
}
