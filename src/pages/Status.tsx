import { useEffect, useState } from 'react';
import { check, errText, must, useApp } from '../ui.tsx';

interface Live { server_time: string; online_15m: number; sessions_today: number; devices_total: number; places_published: number; ads_active: number; ads_enabled: boolean; last_event_at: string | null; last_place_at: string | null }
const ago = (iso: string | null): string => {
  if (!iso) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
};

/** Statut en direct : le serveur répond-il, combien d'appareils sont ouverts, rafraîchi toutes les 30 s. */
export function Status() {
  const { sb } = useApp();
  const [live, setLive] = useState<Live | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const load = async () => {
    try {
      const t0 = performance.now();
      check(await sb.rpc('ping'));
      const dt = Math.round(performance.now() - t0);
      const l = must(await sb.rpc('live_status')) as Live;
      setMs(dt); setLive(l); setAt(new Date()); setErr(null);
    } catch (e) { setMs(null); setErr(errText(e)); }
  };
  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const level = err ? 'bad' : ms !== null && ms > 1500 ? 'slow' : 'ok';
  const text = err ? 'Serveur injoignable' : level === 'slow' ? `Serveur lent · ${ms} ms` : `Serveur en ligne · ${ms ?? '…'} ms`;
  return (
    <>
      <h1>Statut en direct</h1>
      <div className="card">
        <div className="live"><span className={'dot2' + (level === 'ok' ? '' : ' ' + level)} aria-hidden="true" />{text}</div>
        {err && <p className="err">{err}</p>}
        <p className="muted" style={{ marginBottom: 0 }}>Mis à jour {at ? at.toLocaleTimeString('fr-FR') : '…'} · rafraîchi toutes les 30 secondes.</p>
      </div>
      {live && (
        <>
          <div className="stats">
            <div className="stat"><b>{live.online_15m}</b><span>appareils en ligne (15 min)</span></div>
            <div className="stat"><b>{live.sessions_today}</b><span>ouvertures de l'app aujourd'hui</span></div>
            <div className="stat"><b>{live.devices_total}</b><span>appareils depuis le début</span></div>
            <div className="stat"><b>{live.places_published}</b><span>lieux publiés</span></div>
            <div className="stat"><b>{live.ads_active}</b><span>annonces actives</span></div>
            <div className="stat"><b>{live.ads_enabled ? 'Activée' : 'Coupée'}</b><span>publicité (interrupteur général)</span></div>
          </div>
          <div className="card">
            <div className="item"><span>Dernier signal reçu d'un appareil</span><b>{ago(live.last_event_at)}</b></div>
            <div className="item"><span>Dernier lieu publié</span><b>{ago(live.last_place_at)}</b></div>
          </div>
          <p className="muted">« En ligne » = appareils dont l'app a signalé sa présence il y a moins de 15 minutes (un signal anonyme toutes les 5 minutes tant que l'app est ouverte). Aucune position ni donnée personnelle n'est enregistrée.</p>
        </>
      )}
    </>
  );
}
