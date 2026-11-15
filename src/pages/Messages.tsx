import { useState } from 'react';
import { Loading, check, fmtDate, must, useApp, useLoad, useRun } from '../ui.tsx';

interface Msg { id: string; created_at: string; kind: string; message: string; contact: string | null; app_version: string | null; handled: boolean }
const KIND: Record<string, string> = { problem: 'Problème', idea: 'Idée', other: 'Autre' };

/** Messages envoyés depuis « Signaler un problème » dans l'app. */
export function Messages() {
  const { sb } = useApp();
  const [all, setAll] = useState(false);
  const list = useLoad(async () => {
    let q = sb.from('feedback').select('id,created_at,kind,message,contact,app_version,handled').order('created_at', { ascending: false }).limit(100);
    if (!all) q = q.eq('handled', false);
    return (must(await q) as Msg[] | null) ?? [];
  }, [all]);
  const { run } = useRun();
  const mark = (m: Msg) => run(async () => { check(await sb.from('feedback').update({ handled: !m.handled }).eq('id', m.id)); list.reload(); }, m.handled ? 'Remis à traiter' : 'Marqué comme traité');
  return (
    <>
      <h1>Messages</h1>
      <div className="seg"><button className={!all ? 'on' : ''} onClick={() => setAll(false)}>À traiter</button><button className={all ? 'on' : ''} onClick={() => setAll(true)}>Tous</button></div>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">Aucun message.</p>}
        {(list.data ?? []).map((m) => (
          <div className="item" key={m.id} style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="badge">{KIND[m.kind] ?? m.kind}</span> <span className="muted">{fmtDate(m.created_at)}{m.app_version ? ` · v${m.app_version}` : ''}</span>
              <div style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{m.message}</div>
              <div className="muted">Contact : {m.contact ?? 'non indiqué'}</div>
            </div>
            <button className={m.handled ? '' : 'primary'} onClick={() => void mark(m)}>{m.handled ? 'Rouvrir' : 'Marquer traité'}</button>
          </div>
        ))}
      </div>
    </>
  );
}
