import { Loading, check, must, useApp, useLoad, useRun } from '../ui.tsx';

interface P { id: string; name: string; neighborhood: string | null; city: string }
interface R { id: string; reason: string; places: { name: string } | null }
interface S { id: string; proposed_name: string | null; network: string | null }
const REASON: Record<string, string> = { wrong_info: 'information incorrecte', closed: 'établissement fermé', wrong_price: 'prix incorrect', other: 'autre problème', abusive_review: 'avis abusif' };

/** Accueil : ce qui attend une décision, avec les actions directement dans la liste. */
export function Queue() {
  const { sb, go } = useApp();
  const { run } = useRun();
  const s = useLoad(async () => {
    const places = (must(await sb.from('places').select('id,name,neighborhood,city').eq('status', 'pending').order('created_at')) as P[] | null) ?? [];
    const reports = (must(await sb.from('reports').select('id,reason,places(name)').eq('resolved', false).order('created_at')) as unknown as R[] | null) ?? [];
    const subs = (must(await sb.from('source_submissions').select('id,proposed_name,network').eq('status', 'pending').order('created_at')) as S[] | null) ?? [];
    return { places, reports, subs };
  }, []);
  const d = s.data;
  const total = d ? d.places.length + d.reports.length + d.subs.length : 0;
  const setStatus = (id: string, status: 'published' | 'draft') => run(async () => { check(await sb.rpc('set_place_status', { p_id: id, p_status: status })); s.reload(); }, status === 'published' ? 'Lieu publié' : 'Lieu renvoyé en brouillon');
  const solve = (id: string) => run(async () => { check(await sb.from('reports').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', id)); s.reload(); }, 'Signalement traité');
  return (
    <>
      <div className="sechead"><h1 style={{ margin: 0 }}>Aujourd'hui</h1>{d && <span className="count" aria-label={`${total} éléments à traiter`}>{total}</span>}</div>
      <Loading s={s} />
      {d && total === 0 && <div className="card"><b>Rien à traiter.</b><p className="muted" style={{ margin: '4px 0 0' }}>Les lieux proposés, les signalements et les soumissions apparaîtront ici.</p></div>}
      {d?.places.map((p) => (
        <div className="q" key={p.id}><i className="bar" style={{ background: 'var(--attn)' }} /><div className="c">
          <b>{p.name}</b><span className="muted">Lieu proposé · {p.neighborhood ?? p.city}</span>
          <div className="acts"><button className="primary" onClick={() => void setStatus(p.id, 'published')}>Publier</button><button onClick={() => void setStatus(p.id, 'draft')}>Refuser</button><button onClick={() => go('places')}>Ouvrir</button></div>
        </div></div>
      ))}
      {d?.reports.map((r) => (
        <div className="q" key={r.id}><i className="bar" style={{ background: 'var(--danger)' }} /><div className="c">
          <b>{r.places?.name ?? 'Lieu supprimé'}</b><span className="muted">Signalement : {REASON[r.reason] ?? r.reason}</span>
          <div className="acts"><button className="primary" onClick={() => void solve(r.id)}>Marquer traité</button><button onClick={() => go('flags')}>Détails</button></div>
        </div></div>
      ))}
      {d?.subs.map((x) => (
        <div className="q" key={x.id}><i className="bar" style={{ background: 'var(--sub)' }} /><div className="c">
          <b>{x.proposed_name ?? 'Sans nom'}</b><span className="muted">Soumission · {x.network ?? 'lien'}</span>
          <div className="acts"><button className="primary" onClick={() => go('subs')}>Examiner</button></div>
        </div></div>
      ))}
    </>
  );
}
