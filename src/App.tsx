import { useEffect, useMemo, useState, type ComponentType } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { can, isStaff, type Action } from './lib/permissions.ts';
import { validateConfig } from './lib/validate.ts';
import { clearConfig, loadConfig, makeClient, saveConfig, type Config } from './supabase.ts';
import { useThemePref } from './theme.ts';
import { Ctx, Field, errText, type Profile } from './ui.tsx';
import { Queue } from './pages/Queue.tsx';
import { Status } from './pages/Status.tsx';
import { Reports } from './pages/Reports.tsx';
import { Places } from './pages/Places.tsx';
import { Submissions, Reports as Signalements, Reviews } from './pages/Moderation.tsx';
import { Ads } from './pages/Ads.tsx';
import { Categories, Settings, Users } from './pages/Admin.tsx';

interface PageDef { id: string; label: string; icon: string; need: Action; el: ComponentType; tab?: boolean }
const PAGES: PageDef[] = [
  { id: 'queue', label: 'À traiter', icon: 'ti-inbox', need: 'dashboard.view', el: Queue, tab: true },
  { id: 'places', label: 'Lieux', icon: 'ti-map-pin', need: 'places.view', el: Places, tab: true },
  { id: 'ads', label: 'Annonces', icon: 'ti-speakerphone', need: 'ads.manage', el: Ads, tab: true },
  { id: 'reports', label: 'Rapports', icon: 'ti-chart-bar', need: 'dashboard.view', el: Reports, tab: true },
  { id: 'status', label: 'Statut en direct', icon: 'ti-activity', need: 'dashboard.view', el: Status },
  { id: 'subs', label: 'Soumissions', icon: 'ti-link', need: 'submissions.view', el: Submissions },
  { id: 'flags', label: 'Signalements', icon: 'ti-flag', need: 'reports.handle', el: Signalements },
  { id: 'reviews', label: 'Avis', icon: 'ti-star', need: 'reviews.moderate', el: Reviews },
  { id: 'cats', label: 'Catégories', icon: 'ti-tags', need: 'categories.manage', el: Categories },
  { id: 'users', label: 'Utilisateurs', icon: 'ti-users', need: 'users.manage', el: Users },
  { id: 'settings', label: 'Réglages', icon: 'ti-settings', need: 'settings.manage', el: Settings },
];
const THEME_ICON = { light: 'ti-sun', dark: 'ti-moon', auto: 'ti-device-mobile' } as const;
const THEME_LABEL = { light: 'Thème clair', dark: 'Thème sombre', auto: 'Thème automatique' } as const;

function Setup({ onDone }: { onDone: (c: Config) => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const err = url || key ? validateConfig(url, key) : null;
  return (
    <div className="content"><div className="card">
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
    <div className="content"><div className="card" style={{ maxWidth: 420, margin: '8vh auto 0' }}>
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
  const theme = useThemePref();
  const [config, setConfig] = useState<Config | null>(loadConfig);
  const sb = useMemo(() => (config ? makeClient(config) : null), [config]);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [page, setPage] = useState('queue');
  const [more, setMore] = useState(false);
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
  if (userId === undefined) return <div className="content"><p className="muted">Chargement…</p></div>;
  if (!userId) return <Login sb={sb} />;
  if (problem) return <div className="content"><div className="card"><p className="err">Erreur : {problem}</p><button onClick={() => void sb.auth.signOut()}>Se déconnecter</button></div></div>;
  if (!profile) return <div className="content"><p className="muted">Chargement du profil…</p></div>;
  if (!isStaff(profile.role)) {
    return <div className="content"><div className="card"><h1>Accès refusé</h1><p>Ce compte n'a pas accès à l'administration. Demandez un rôle au super administrateur.</p><button onClick={() => void sb.auth.signOut()}>Se déconnecter</button></div></div>;
  }

  const visible = PAGES.filter((p) => can(profile.role, p.need));
  const current = visible.find((p) => p.id === page) ?? visible[0];
  const Page = current?.el;
  const tabs = visible.filter((p) => p.tab);
  const rest = visible.filter((p) => !p.tab);
  const go = (id: string) => { setPage(id); setMore(false); window.scrollTo({ top: 0 }); };
  const themeBtn = (
    <button className="iconbtn" onClick={theme.next} aria-label={THEME_LABEL[theme.pref]} title={THEME_LABEL[theme.pref]}>
      <i className={`ti ${THEME_ICON[theme.pref]}`} aria-hidden="true" />
    </button>
  );

  return (
    <Ctx.Provider value={{ sb, profile, go, toast: (text, bad = false) => setToastMsg({ text, bad }) }}>
      <div className="shell">
        <nav className="side" aria-label="Navigation">
          <div className="brand">Balade</div>
          {visible.map((p) => <button key={p.id} className={'nl' + (p.id === current?.id ? ' on' : '')} onClick={() => go(p.id)}><i className={`ti ${p.icon}`} aria-hidden="true" />{p.label}</button>)}
          <div className="grow" />
          <button className="nl" onClick={() => void sb.auth.signOut()}><i className="ti ti-logout" aria-hidden="true" />Quitter</button>
        </nav>
        <header className="topbar">
          <div><small>Balade · {profile.role.replace('_', ' ')}</small><b>{current?.label}</b></div>
          <div>{themeBtn}</div>
        </header>
        <main className="content">{Page ? <Page key={current?.id} /> : <p>Aucune page disponible pour ce rôle.</p>}</main>
      </div>
      <nav className="tabs" aria-label="Navigation principale">
        {tabs.map((p) => <button key={p.id} className={p.id === current?.id ? 'on' : ''} onClick={() => go(p.id)}><i className={`ti ${p.icon}`} aria-hidden="true" />{p.label}</button>)}
        <button className={more ? 'on' : ''} onClick={() => setMore(true)}><i className="ti ti-dots" aria-hidden="true" />Plus</button>
      </nav>
      {more && (
        <div className="sheetbg" onClick={() => setMore(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <p className="muted" style={{ margin: '0 8px 6px' }}>{profile.email}</p>
            {rest.map((p) => <button key={p.id} className="nl" onClick={() => go(p.id)}><i className={`ti ${p.icon}`} aria-hidden="true" />{p.label}</button>)}
            <button className="nl" onClick={theme.next}><i className={`ti ${THEME_ICON[theme.pref]}`} aria-hidden="true" />{THEME_LABEL[theme.pref]} (toucher pour changer)</button>
            <button className="nl" onClick={() => void sb.auth.signOut()}><i className="ti ti-logout" aria-hidden="true" />Quitter</button>
          </div>
        </div>
      )}
      {toastMsg && <div className={'toast' + (toastMsg.bad ? ' bad' : '')} role="status">{toastMsg.text}</div>}
    </Ctx.Provider>
  );
}
