import { Loading, must, useApp, useLoad } from '../ui.tsx';

interface AdRow { id: string; title: string; status: string; placement: string; impressions: number; clicks: number }

export function Dashboard() {
  const { sb } = useApp();
  const s = useLoad(async () => {
    const count = async (table: string, f: (q: any) => any) => {
      const r = await f(sb.from(table).select('*', { count: 'exact', head: true }));
      if (r.error) throw new Error(r.error.message);
      return (r.count ?? 0) as number;
    };
    const [published, pending, subs, reports, activeAds] = await Promise.all([
      count('places', (q) => q.eq('status', 'published')),
      count('places', (q) => q.eq('status', 'pending')),
      count('source_submissions', (q) => q.eq('status', 'pending')),
      count('reports', (q) => q.eq('resolved', false)),
      count('ads', (q) => q.eq('status', 'active')),
    ]);
    const ads = must(await sb.from('ads').select('id,title,status,placement,impressions,clicks').order('impressions', { ascending: false }).limit(10)) as AdRow[] | null;
    return { published, pending, subs, reports, activeAds, ads: ads ?? [] };
  }, []);
  const d = s.data;
  return (
    <>
      <h1>Tableau de bord</h1>
      <Loading s={s} />
      {d && (
        <>
          <div className="stats">
            <div className="card stat"><b>{d.published}</b>lieux publiés</div>
            <div className="card stat"><b>{d.pending}</b>lieux en attente</div>
            <div className="card stat"><b>{d.subs}</b>soumissions à traiter</div>
            <div className="card stat"><b>{d.reports}</b>signalements ouverts</div>
            <div className="card stat"><b>{d.activeAds}</b>annonces actives</div>
          </div>
          <h2>Annonces : affichages et clics</h2>
          <div className="card">
            {d.ads.length === 0 && <p className="muted">Aucune annonce pour l'instant.</p>}
            {d.ads.map((a) => (
              <div className="item" key={a.id}>
                <div><b>{a.title}</b><div className="muted">{a.placement} · {a.status}</div></div>
                <div className="muted">{a.impressions} aff. · {a.clicks} clics · {a.impressions ? ((a.clicks / a.impressions) * 100).toFixed(1) : '0'} %</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
