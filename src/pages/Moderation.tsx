import { useState } from 'react';
import { can } from '../lib/permissions.ts';
import { Loading, check, fmtDate, must, useApp, useLoad, useRun } from '../ui.tsx';

interface Sub { id: string; url: string | null; network: string | null; proposed_name: string | null; proposed_city: string | null; notes: string | null; created_at: string; status: string }
export function Submissions() {
  const { sb, profile } = useApp();
  const list = useLoad(async () => (must(await sb.from('source_submissions').select('*').eq('status', 'pending').order('created_at')) as Sub[] | null) ?? [], []);
  const { run } = useRun();
  const [note, setNote] = useState<Record<string, string>>({});
  const decide = (s: Sub, status: 'approved' | 'rejected') => run(async () => {
    if (status === 'approved') {
      check(await sb.from('places').insert({ name: s.proposed_name?.trim() || 'À compléter', city: s.proposed_city?.trim() || 'Brazzaville', source_url: s.url, status: 'draft', verification: 'unverified', created_by: profile.id, is_demo: false }));
    }
    check(await sb.from('source_submissions').update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), reviewed_note: note[s.id]?.trim() || null }).eq('id', s.id));
    list.reload();
  }, status === 'approved' ? 'Brouillon de lieu créé : complétez-le dans « Lieux »' : 'Soumission rejetée');
  return (
    <>
      <h1>Soumissions à traiter</h1>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">Rien à traiter.</p>}
        {(list.data ?? []).map((s) => (
          <div className="item" key={s.id} style={{ alignItems: 'flex-start' }}>
            <div>
              <b>{s.proposed_name ?? 'Sans nom'}</b> · {s.proposed_city ?? '—'} <span className="badge">{s.network ?? 'autre'}</span>
              <div className="muted">{fmtDate(s.created_at)}{s.notes ? ' · ' + s.notes : ''}</div>
              {s.url && <a href={s.url} target="_blank" rel="noreferrer">Voir la publication ↗</a>}
              <input placeholder="Note (facultatif)" value={note[s.id] ?? ''} onChange={(e) => setNote({ ...note, [s.id]: e.target.value })} />
            </div>
            <div className="row" style={{ flex: '0 0 auto' }}>
              {can(profile.role, 'submissions.approve') && <button className="primary" onClick={() => void decide(s, 'approved')}>Créer un brouillon</button>}
              <button className="danger" onClick={() => void decide(s, 'rejected')}>Rejeter</button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted">Le contenu des réseaux sociaux n'est jamais copié automatiquement : vous complétez la fiche vous-même et respectez les droits de l'auteur.</p>
    </>
  );
}

interface Rep { id: string; reason: string; details: string | null; created_at: string; places: { name: string } | null }
const REASON: Record<string, string> = { wrong_info: 'Information incorrecte', closed: 'Établissement fermé', wrong_price: 'Prix incorrect', other: 'Autre' };
export function Reports() {
  const { sb, profile } = useApp();
  const list = useLoad(async () => (must(await sb.from('reports').select('id,reason,details,created_at,places(name)').eq('resolved', false).order('created_at')) as unknown as Rep[] | null) ?? [], []);
  const { run } = useRun();
  const done = (id: string) => run(async () => { check(await sb.from('reports').update({ resolved: true, resolved_by: profile.id, resolved_at: new Date().toISOString() }).eq('id', id)); list.reload(); }, 'Signalement traité');
  return (
    <>
      <h1>Signalements</h1>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">Aucun signalement ouvert.</p>}
        {(list.data ?? []).map((r) => (
          <div className="item" key={r.id}>
            <div><b>{r.places?.name ?? 'Lieu supprimé'}</b> <span className="badge">{REASON[r.reason] ?? r.reason}</span><div className="muted">{fmtDate(r.created_at)}{r.details ? ' · ' + r.details : ''}</div></div>
            <button className="primary" onClick={() => void done(r.id)}>Marquer traité</button>
          </div>
        ))}
      </div>
    </>
  );
}

interface Rev { id: string; rating: number; comment: string | null; hidden: boolean; created_at: string; places: { name: string } | null }
export function Reviews() {
  const { sb } = useApp();
  const list = useLoad(async () => (must(await sb.from('reviews').select('id,rating,comment,hidden,created_at,places(name)').order('created_at', { ascending: false }).limit(100)) as unknown as Rev[] | null) ?? [], []);
  const { run } = useRun();
  const toggle = (r: Rev) => run(async () => { check(await sb.from('reviews').update({ hidden: !r.hidden }).eq('id', r.id)); list.reload(); }, r.hidden ? 'Avis affiché' : 'Avis masqué');
  return (
    <>
      <h1>Avis</h1>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">Aucun avis pour l'instant.</p>}
        {(list.data ?? []).map((r) => (
          <div className="item" key={r.id}>
            <div><b>{r.places?.name ?? '—'}</b> · {'★'.repeat(r.rating)} {r.hidden && <span className="badge">masqué</span>}<div className="muted">{fmtDate(r.created_at)} · {r.comment ?? 'Sans commentaire'}</div></div>
            <button onClick={() => void toggle(r)}>{r.hidden ? 'Afficher' : 'Masquer'}</button>
          </div>
        ))}
      </div>
    </>
  );
}
