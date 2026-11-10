import { useEffect, useMemo, useState, type ComponentType } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { can, isStaff, type Action } from './lib/permissions.ts';
import { validateConfig } from './lib/validate.ts';
import { clearConfig, loadConfig, makeClient, saveConfig, type Config } from './supabase.ts';
import { Ctx, Field, errText, type Profile } from './ui.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Places } from './pages/Places.tsx';
import { Submissions, Reports, Reviews } from './pages/Moderation.tsx';
import { Ads } from './pages/Ads.tsx';
import { Categories, Settings, Users } from './pages/Admin.tsx';

const PAGES: { id: string; label: string; need: Action; el: ComponentType }[] = [
  { id: 'dash', label: 'Tableau de bord', need: 'dashboard.view', el: Dashboard },
  { id: 'places', label: 'Lieux', need: 'places.view', el: Places },
  { id: 'subs', label: 'Soumissions', need: 'submissions.view', el: Submissions },
  { id: 'reports', label: 'Signalements', need: 'reports.handle', el: Reports },
  { id: 'reviews', label: 'Avis', need: 'reviews.moderate', el: Reviews },
  { id: 'ads', label: 'Annonces', need: 'ads.manage', el: Ads },
  { id: 'cats', label: 'Catégories', need: 'categories.manage', el: Categories },
  { id: 'users', label: 'Utilisateurs', need: 'users.manage', el: Users },
  { id: 'settings', label: 'Réglages', need: 'settings.manage', el: Settings },
];

function Setup({ onDone }: { onDone: (c: Config) => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const err = url || key ? validateConfig(url, key) : null;
  return (
    <div className="page"><div className="card">
      <h1>Connexion au serveur</h1>
      <p className="muted">Une seule fois sur cet appareil. Collez l'adresse du projet Supabase et la clé publique « anon ». N'utilisez jamais la clé « service_role ».</p>
      <Field label="Adresse du projet"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></Field>
      <Field label="Clé publique « anon »"><textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJ…" /></Field>
      {err && <p className="err">{err}</p>}
      <button className="primary" disabled={!url || !key || !!err} onClick={() => { const c = { url: url.trim(), anonKey: key.trim() }; saveConfig(c); onDone(c); }}>Enregistrer</button>
    </div></div>
  );
}

function Login({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) setMsg('Connexion impossible : ' + error.message);
    setBusy(false);
  };
  return (
    <div className="page"><div className="card">
      <h1>Balade · Administration</h1>
      <Field label="E-mail"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Mot de passe"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} /></Field>
      {msg && <p className="err">{msg}</p>}
      <p><button className="primary" disabled={busy || !email || !pw} onClick={() => void go()}>Se connecter</button></p>
      <p><button onClick={() => { clearConfig(); location.reload(); }}>Changer de serveur</button></p>
    </div></div>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(loadConfig);
  const sb = useMemo(() => (config ? makeClient(config) : null), [config]);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [page, setPage] = useState('dash');
  const [toastMsg, setToastMsg] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setUserId(s?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    if (!sb || !userId) { setProfile(null); return; }
    sb.from('profiles').select('id,email,display_name,role').eq('id', userId).single()
      .then(({ data, error }) => { if (error) setProblem(error.message); else setProfile(data as Profile); }, (e: unknown) => setProblem(errText(e)));
  }, [sb, userId]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  if (!config || !sb) return <Setup onDone={setConfig} />;
  if (userId === undefined) return <div className="page"><p className="muted">Chargement…</p></div>;
  if (!userId) return <Login sb={sb} />;
  if (problem) return <div className="page"><div className="card"><p className="err">Erreur : {problem}</p><button onClick={() => void sb.auth.signOut()}>Se déconnecter</button></div></div>;
  if (!profile) return <div className="page"><p className="muted">Chargement du profil…</p></div>;
  if (!isStaff(profile.role)) {
    return <div className="page"><div className="card"><h1>Accès refusé</h1><p>Ce compte n'a pas accès à l'administration. Demandez un rôle au super administrateur.</p><button onClick={() => void sb.auth.signOut()}>Se déconnecter</button></div></div>;
  }

  const visible = PAGES.filter((p) => can(profile.role, p.need));
  const current = visible.find((p) => p.id === page) ?? visible[0];
  const Page = current?.el;
  return (
    <Ctx.Provider value={{ sb, profile, toast: (text, bad = false) => setToastMsg({ text, bad }) }}>
      <div className="top">
        <div><b>Balade</b> <small>· {profile.role.replace('_', ' ')}</small></div>
        <div><small>{profile.email}</small> <button onClick={() => void sb.auth.signOut()}>Quitter</button></div>
      </div>
      <div className="nav">{visible.map((p) => <button key={p.id} className={p.id === current?.id ? 'on' : ''} onClick={() => setPage(p.id)}>{p.label}</button>)}</div>
      <div className="page">{Page ? <Page key={current?.id} /> : <p>Aucune page disponible pour ce rôle.</p>}</div>
      {toastMsg && <div className={'toast' + (toastMsg.bad ? ' bad' : '')} role="status">{toastMsg.text}</div>}
    </Ctx.Provider>
  );
}
