import { useState } from 'react';
import { ctr, delta, periodRange, toCsv, type PeriodKind } from '../lib/periods.ts';
import { Loading, must, useApp, useLoad } from '../ui.tsx';

interface Rep {
  sessions: number; place_views: number; route_starts: number; active_devices: number; new_devices: number;
  ad_impressions: number; ad_clicks: number; new_places: number; new_reviews: number; new_reports: number; new_submissions: number;
  daily: { day: string; sessions: number; devices: number }[];
  top_places: { name: string; views: number }[];
  top_ads: { title: string; impressions: number; clicks: number }[];
}
const PERIODS: { id: PeriodKind; label: string }[] = [
  { id: '7d', label: '7 jours' }, { id: '30d', label: '30 jours' }, { id: 'month', label: 'Ce mois-ci' }, { id: 'lastmonth', label: 'Mois dernier' }, { id: '90d', label: '90 jours' },
];
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale

export function Reports() {
  const { sb } = useApp();
  const [kind, setKind] = useState<PeriodKind>('7d');
  const period = periodRange(kind, today());
  const s = useLoad(async () => {
    const [cur, prev] = await Promise.all([
      sb.rpc('report_period', { p_from: period.cur.from, p_to: period.cur.to }),
      sb.rpc('report_period', { p_from: period.prev.from, p_to: period.prev.to }),
    ]);
    return { cur: must(cur) as Rep, prev: must(prev) as Rep };
  }, [kind]);
  const c = s.data?.cur;
  const p = s.data?.prev;
  const kpis: { label: string; k: keyof Rep }[] = [
    { label: "Ouvertures de l'app", k: 'sessions' }, { label: 'Appareils actifs', k: 'active_devices' }, { label: 'Nouveaux appareils', k: 'new_devices' },
    { label: 'Fiches ouvertes', k: 'place_views' }, { label: 'Itinéraires lancés', k: 'route_starts' }, { label: 'Affichages de pub', k: 'ad_impressions' },
    { label: 'Clics sur les pubs', k: 'ad_clicks' }, { label: 'Nouveaux lieux', k: 'new_places' }, { label: 'Avis reçus', k: 'new_reviews' },
    { label: 'Signalements', k: 'new_reports' }, { label: 'Soumissions', k: 'new_submissions' },
  ];
  const max = Math.max(1, ...(c?.daily.map((d) => d.sessions) ?? [1]));
  const csv = () => {
    if (!c) return;
    const rows: (string | number)[][] = [['Période', `${period.cur.from} au ${period.cur.to}`], [], ['Indicateur', 'Valeur'], ...kpis.map((x) => [x.label, Number(c[x.k])]), [], ['Annonce', 'Affichages', 'Clics'], ...c.top_ads.map((a) => [a.title, Number(a.impressions), Number(a.clicks)])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `rapport-balade-${period.cur.from}_${period.cur.to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <h1>Rapports</h1>
      <div className="seg" role="group" aria-label="Période">{PERIODS.map((x) => <button key={x.id} className={x.id === kind ? 'on' : ''} onClick={() => setKind(x.id)}>{x.label}</button>)}</div>
      <p className="muted">{period.label} : du {period.cur.from} au {period.cur.to}. Comparé à du {period.prev.from} au {period.prev.to}.</p>
      <Loading s={s} />
      {c && p && (
        <>
          <div className="stats">
            {kpis.map((x) => {
              const d = delta(Number(c[x.k]), Number(p[x.k]));
              return <div className="stat" key={x.k}><b>{Number(c[x.k])}</b><span>{x.label}</span><br /><em className={d.startsWith('+') || d === 'nouveau' ? 'up' : d.startsWith('-') ? 'down' : ''}>{d} vs période précédente</em></div>;
            })}
          </div>
          <div className="card">
            <b>Ouvertures de l'app par jour</b>
            <div className="bars" role="img" aria-label="Graphique des ouvertures par jour">{c.daily.map((d) => <i key={d.day} title={`${d.day} : ${d.sessions}`} style={{ height: `${(d.sessions / max) * 100}%` }} />)}</div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{period.cur.from}</span><span className="muted" style={{ textAlign: 'right' }}>{period.cur.to}</span></div>
          </div>
          <div className="card">
            <b>Lieux les plus consultés</b>
            {c.top_places.length === 0 ? <p className="muted">Pas encore de données.</p> : (
              <table className="tbl"><tbody>{c.top_places.map((t) => <tr key={t.name}><td>{t.name}</td><td className="r">{Number(t.views)} vues</td></tr>)}</tbody></table>
            )}
          </div>
          <div className="card">
            <b>Annonces</b>
            {c.top_ads.length === 0 ? <p className="muted">Pas encore de données.</p> : (
              <table className="tbl"><thead><tr><th>Annonce</th><th className="r">Affich.</th><th className="r">Clics</th><th className="r">Taux</th></tr></thead>
                <tbody>{c.top_ads.map((a) => <tr key={a.title}><td>{a.title}</td><td className="r">{Number(a.impressions)}</td><td className="r">{Number(a.clicks)}</td><td className="r">{ctr(Number(a.clicks), Number(a.impressions))}</td></tr>)}</tbody></table>
            )}
            <p><button onClick={csv}>Télécharger le rapport (CSV)</button></p>
          </div>
          <p className="muted">Les chiffres viennent de signaux anonymes envoyés par l'app (identifiant aléatoire, sans position ni donnée personnelle). Un appareil qui désactive les statistiques dans son profil n'est pas compté.</p>
        </>
      )}
    </>
  );
}
