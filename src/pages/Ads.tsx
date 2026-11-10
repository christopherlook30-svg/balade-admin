import { useState } from 'react';
import { compressImage } from '../lib/image.ts';
import { validateAd } from '../lib/validate.ts';
import { publicUrl } from '../supabase.ts';
import { Errors, Field, Loading, check, must, useApp, useLoad, useRun } from '../ui.tsx';

interface Adv { id: string; name: string; contact_name: string | null; phone: string | null; notes: string | null }
interface AdRow { id: string; advertiser_id: string | null; title: string; body: string | null; cta_label: string | null; link_url: string | null; video_url: string | null; image_path: string | null; placement: string; city: string | null; weight: number; status: string; starts_at: string | null; ends_at: string | null; impressions: number; clicks: number }
interface Bill { ad_id: string; price_xaf: number | null; paid: boolean; payment_ref: string | null }
const PLACE: Record<string, string> = { banner: 'Bandeau', popup: 'Pop-up (1 annonceur par jour)', list: 'Dans la liste', map_pin: 'Épingle sur la carte' };
const STATUS: Record<string, string> = { draft: 'Brouillon', active: 'Active', paused: 'En pause', ended: 'Terminée' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');

export function Ads() {
  const [tab, setTab] = useState<'ads' | 'adv'>('ads');
  return (
    <>
      <h1>Annonces</h1>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className={tab === 'ads' ? 'on' : ''} onClick={() => setTab('ads')}>Annonces</button>
        <button className={tab === 'adv' ? 'on' : ''} onClick={() => setTab('adv')}>Annonceurs</button>
      </div>
      {tab === 'ads' ? <AdList /> : <Advertisers />}
    </>
  );
}

function Advertisers() {
  const { sb } = useApp();
  const list = useLoad(async () => (must(await sb.from('advertisers').select('*').order('name')) as Adv[] | null) ?? [], []);
  const { run } = useRun();
  const [f, setF] = useState({ name: '', contact_name: '', phone: '', notes: '' });
  const add = () => run(async () => {
    if (f.name.trim().length < 2) throw new Error('Le nom est obligatoire.');
    check(await sb.from('advertisers').insert({ name: f.name.trim(), contact_name: f.contact_name.trim() || null, phone: f.phone.trim() || null, notes: f.notes.trim() || null }));
    setF({ name: '', contact_name: '', phone: '', notes: '' });
    list.reload();
  }, 'Annonceur ajouté');
  const del = (a: Adv) => run(async () => { check(await sb.from('advertisers').delete().eq('id', a.id)); list.reload(); }, 'Annonceur supprimé');
  return (
    <>
      <div className="card">
        <div className="row">
          <Field label="Commerce / annonceur *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Contact"><input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
          <Field label="Téléphone / MoMo"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p><button className="primary" onClick={() => void add()}>Ajouter</button></p>
      </div>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).map((a) => (
          <div className="item" key={a.id}><div><b>{a.name}</b><div className="muted">{a.contact_name ?? '—'} · {a.phone ?? '—'}</div></div><button className="danger" onClick={() => void del(a)}>Supprimer</button></div>
        ))}
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">Aucun annonceur.</p>}
      </div>
    </>
  );
}

function AdList() {
  const { sb } = useApp();
  const [editing, setEditing] = useState<AdRow | 'new' | null>(null);
  const list = useLoad(async () => (must(await sb.from('ads').select('*').order('created_at', { ascending: false })) as AdRow[] | null) ?? [], []);
  const advs = useLoad(async () => (must(await sb.from('advertisers').select('id,name').order('name')) as { id: string; name: string }[] | null) ?? [], []);
  if (editing) return <AdEditor ad={editing === 'new' ? null : editing} advs={advs.data ?? []} onClose={() => { setEditing(null); list.reload(); }} />;
  return (
    <>
      <p><button className="primary" onClick={() => setEditing('new')}>+ Nouvelle annonce</button></p>
      <Loading s={list} />
      <div className="card">
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">Aucune annonce.</p>}
        {(list.data ?? []).map((a) => (
          <div className="item" key={a.id}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              {a.image_path ? <img className="thumb" src={publicUrl(sb, 'ad-media', a.image_path)} alt="" /> : <div className="thumb" />}
              <div><b>{a.title}</b><div className="muted">{PLACE[a.placement]} · <span className="badge">{STATUS[a.status]}</span></div><div className="muted">{a.impressions} aff. · {a.clicks} clics</div></div>
            </div>
            <button onClick={() => setEditing(a)}>Ouvrir</button>
          </div>
        ))}
      </div>
    </>
  );
}

function AdEditor({ ad, advs, onClose }: { ad: AdRow | null; advs: { id: string; name: string }[]; onClose: () => void }) {
  const { sb } = useApp();
  const { run, busy } = useRun();
  const bill = useLoad(async () => (ad ? (must(await sb.from('ad_billing').select('*').eq('ad_id', ad.id).maybeSingle()) as Bill | null) : null), [ad?.id]);
  const [id, setId] = useState<string | null>(ad?.id ?? null);
  const [f, setF] = useState({
    advertiser_id: ad?.advertiser_id ?? '', title: ad?.title ?? '', body: ad?.body ?? '', cta: ad?.cta_label ?? '', link: ad?.link_url ?? '', video: ad?.video_url ?? '',
    placement: ad?.placement ?? 'banner', city: ad?.city ?? '', weight: String(ad?.weight ?? 1), status: ad?.status ?? 'draft', starts: day(ad?.starts_at ?? null), ends: day(ad?.ends_at ?? null), image: ad?.image_path ?? '',
  });
  const [price, setPrice] = useState('');
  const [paid, setPaid] = useState(false);
  const [ref, setRef] = useState('');
  const [loadedBill, setLoadedBill] = useState(false);
  if (bill.data && !loadedBill) { setLoadedBill(true); setPrice(bill.data.price_xaf != null ? String(bill.data.price_xaf) : ''); setPaid(bill.data.paid); setRef(bill.data.payment_ref ?? ''); }
  const [errors, setErrors] = useState<string[]>([]);
  const up = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  const save = async () => {
    const e = validateAd({ title: f.title, body: f.body, cta: f.cta, link: f.link, video: f.video, weight: Number(f.weight), starts: f.starts, ends: f.ends, placement: f.placement });
    if (price && !(Number(price) >= 0)) e.push('Le prix doit être un nombre positif.');
    setErrors(e);
    if (e.length) return;
    await run(async () => {
      const row = {
        advertiser_id: f.advertiser_id || null, title: f.title.trim(), body: f.body.trim() || null, cta_label: f.cta.trim() || null, link_url: f.link.trim() || null, video_url: f.video.trim() || null,
        image_path: f.image || null, placement: f.placement, city: f.city.trim() || null, weight: Number(f.weight), status: f.status,
        starts_at: f.starts ? `${f.starts}T00:00:00+01:00` : null, ends_at: f.ends ? `${f.ends}T23:59:59+01:00` : null,
      };
      let adId = id;
      if (adId) check(await sb.from('ads').update(row).eq('id', adId));
      else { const r = must(await sb.from('ads').insert(row).select('id').single()) as { id: string }; adId = r.id; setId(adId); }
      check(await sb.from('ad_billing').upsert({ ad_id: adId, price_xaf: price ? Number(price) : null, paid, paid_at: paid ? new Date().toISOString() : null, payment_ref: ref.trim() || null }, { onConflict: 'ad_id' }));
    }, 'Annonce enregistrée');
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      const blob = await compressImage(file, 1200);
      const path = `${crypto.randomUUID()}.jpg`;
      check(await sb.storage.from('ad-media').upload(path, blob, { contentType: 'image/jpeg' }));
      setF((p) => ({ ...p, image: path }));
    }, 'Image envoyée : pensez à enregistrer');
  };
  const del = () => run(async () => { if (id) check(await sb.from('ads').delete().eq('id', id)); onClose(); }, 'Annonce supprimée');

  return (
    <>
      <p><button onClick={onClose}>← Retour</button></p>
      <h2 style={{ marginTop: 0 }}>{id ? "Modifier l'annonce" : 'Nouvelle annonce'}</h2>
      <div className="card">
        <Field label="Annonceur"><select value={f.advertiser_id} onChange={(e) => up('advertiser_id', e.target.value)}><option value="">—</option>{advs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Titre * (60 caractères max)"><input value={f.title} onChange={(e) => up('title', e.target.value)} /></Field>
        <Field label="Texte (140 caractères max)"><textarea value={f.body} onChange={(e) => up('body', e.target.value)} /></Field>
        <div className="row">
          <Field label="Texte du bouton (20 max)"><input value={f.cta} onChange={(e) => up('cta', e.target.value)} placeholder="Voir l'offre" /></Field>
          <Field label="Lien (https://… ou tel:+242…)"><input value={f.link} onChange={(e) => up('link', e.target.value)} /></Field>
        </div>
        <Field label="Lien vidéo (YouTube, Facebook, TikTok… en https)"><input value={f.video} onChange={(e) => up('video', e.target.value)} /></Field>
        <Field label="Image">
          {f.image && <p><img className="thumb" style={{ width: 160, height: 100 }} src={publicUrl(sb, 'ad-media', f.image)} alt="" /></p>}
          <input type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} />
        </Field>
      </div>
      <div className="card">
        <div className="row">
          <Field label="Emplacement"><select value={f.placement} onChange={(e) => up('placement', e.target.value)}>{Object.entries(PLACE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Ville (vide = toutes)"><input value={f.city} onChange={(e) => up('city', e.target.value)} /></Field>
          <Field label="Priorité (1 à 10)"><input inputMode="numeric" value={f.weight} onChange={(e) => up('weight', e.target.value)} /></Field>
        </div>
        <div className="row">
          <Field label="Début"><input type="date" value={f.starts} onChange={(e) => up('starts', e.target.value)} /></Field>
          <Field label="Fin"><input type="date" value={f.ends} onChange={(e) => up('ends', e.target.value)} /></Field>
          <Field label="État"><select value={f.status} onChange={(e) => up('status', e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <p className="muted">Toujours affichée avec la mention « Sponsorisé ». N'est montrée que si elle est « Active » et dans ses dates.</p>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Paiement (visible par vous seul)</h2>
        <div className="row">
          <Field label="Prix convenu (FCFA)"><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Référence MoMo"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        <label><input type="checkbox" style={{ width: 'auto' }} checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Payée</label>
      </div>
      <Errors list={errors} />
      <p className="row"><button className="primary" disabled={busy} onClick={() => void save()}>Enregistrer</button>{id && <button className="danger" onClick={() => void del()}>Supprimer</button>}</p>
    </>
  );
}
