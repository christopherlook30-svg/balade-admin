import { useState } from 'react';
import { can } from '../lib/permissions.ts';
import { compressImage } from '../lib/image.ts';
import { parseLatLng, validatePlace, type PlaceForm } from '../lib/validate.ts';
import { publicUrl } from '../supabase.ts';
import { Errors, Field, Loading, check, fmtDate, must, useApp, useLoad, useRun } from '../ui.tsx';

interface Cat { id: number; label_fr: string }
interface Row { id: string; name: string; city: string; neighborhood: string | null; status: string; verification: string; is_demo: boolean }
interface Photo { id: string; storage_path: string; credit: string | null; rights_confirmed: boolean }
type Status = PlaceForm['status'];
const STATUS: Record<string, string> = { draft: 'Brouillon', pending: 'En attente', published: 'Publié', archived: 'Archivé' };

interface F {
  id: string | null; name: string; description: string; category_id: string; city: string; neighborhood: string; address: string;
  coords: string; hours: string; phone: string; website: string; source_url: string; status: Status; verification: string; last_verified_at: string | null;
  basis: PlaceForm['basis']; kind: string; min: string; max: string; extra: string;
}
const empty = (): F => ({ id: null, name: '', description: '', category_id: '', city: 'Brazzaville', neighborhood: '', address: '', coords: '', hours: '', phone: '', website: '', source_url: '', status: 'draft', verification: 'unverified', last_verified_at: null, basis: 'unknown', kind: '', min: '', max: '', extra: '0' });
const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const toForm = (f: F): PlaceForm => {
  const c = parseLatLng(f.coords);
  return { name: f.name, city: f.city, category_id: f.category_id ? Number(f.category_id) : null, lat: c?.lat ?? null, lng: c?.lng ?? null, status: f.status, basis: f.basis, kind: (f.kind || null) as PlaceForm['kind'], min: num(f.min), max: num(f.max), extraFees: num(f.extra) ?? 0, website: f.website, phone: f.phone };
};

export function Places() {
  const { sb, profile } = useApp();
  const canWrite = can(profile.role, 'places.write');
  const canModerate = can(profile.role, 'places.moderate');
  const [editing, setEditing] = useState<F | null>(null);
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const cats = useLoad(async () => (must(await sb.from('categories').select('id,label_fr').order('sort')) as Cat[] | null) ?? [], []);
  const list = useLoad(async () => (must(await sb.from('places').select('id,name,city,neighborhood,status,verification,is_demo').order('created_at', { ascending: false }).limit(300)) as Row[] | null) ?? [], []);
  const { run } = useRun();

  const open = async (id: string | null) => {
    if (!id) { setEditing(empty()); return; }
    const p = must(await sb.from('places').select('*').eq('id', id).single()) as Record<string, any>;
    const pr = must(await sb.from('price_ranges').select('*').eq('place_id', id).maybeSingle()) as Record<string, any> | null;
    setEditing({
      id, name: p.name, description: p.description ?? '', category_id: p.category_id ? String(p.category_id) : '', city: p.city, neighborhood: p.neighborhood ?? '', address: p.address ?? '',
      coords: p.lat != null && p.lng != null ? `${p.lat}, ${p.lng}` : '', hours: p.hours ?? '', phone: p.phone ?? '', website: p.website ?? '', source_url: p.source_url ?? '',
      status: p.status, verification: p.verification, last_verified_at: p.last_verified_at,
      basis: pr?.basis ?? 'unknown', kind: pr?.kind ?? '', min: pr?.min_amount != null ? String(pr.min_amount) : '', max: pr?.max_amount != null ? String(pr.max_amount) : '', extra: pr?.extra_fees != null ? String(pr.extra_fees) : '0',
    });
  };
  const setStatus = (id: string, status: Status) => run(async () => { check(await sb.rpc('set_place_status', { p_id: id, p_status: status })); list.reload(); }, 'État mis à jour');
  const shown = (list.data ?? []).filter((r) => (!st || r.status === st) && (!q || (r.name + ' ' + (r.neighborhood ?? '')).toLowerCase().includes(q.toLowerCase())));

  if (editing) return <Editor f={editing} setF={setEditing} cats={cats.data ?? []} canWrite={canWrite} onClose={() => { setEditing(null); list.reload(); }} />;
  return (
    <>
      <h1>Lieux</h1>
      <div className="row">
        <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">Tous les états</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {can(profile.role, 'places.propose') && <button className="primary" onClick={() => void open(null)}>+ Nouveau lieu</button>}
      </div>
      <Loading s={list} />
      <div className="card">
        {shown.length === 0 && !list.loading && <p className="muted">Aucun lieu.</p>}
        {shown.map((r) => (
          <div className="item" key={r.id}>
            <div><b>{r.name}</b> {r.is_demo && <span className="badge">DÉMO</span>}<div className="muted">{r.neighborhood ?? '—'} · {r.city} · <span className="badge">{STATUS[r.status]}</span></div></div>
            <div className="row" style={{ flex: '0 0 auto' }}>
              {canModerate && r.status === 'pending' && <><button className="primary" onClick={() => void setStatus(r.id, 'published')}>Publier</button><button onClick={() => void setStatus(r.id, 'draft')}>Refuser</button></>}
              <button onClick={() => void open(r.id)}>Ouvrir</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Editor({ f, setF, cats, canWrite, onClose }: { f: F; setF: (f: F) => void; cats: Cat[]; canWrite: boolean; onClose: () => void }) {
  const { sb, profile } = useApp();
  const { run, busy } = useRun();
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof F>(k: K, v: F[K]) => setF({ ...f, [k]: v });
  const readOnly = !canWrite && f.id !== null && f.status !== 'draft' && f.status !== 'pending';
  const photos = useLoad(async () => (f.id ? ((must(await sb.from('place_photos').select('id,storage_path,credit,rights_confirmed').eq('place_id', f.id).order('sort')) as Photo[] | null) ?? []) : []), [f.id]);
  const [credit, setCredit] = useState('');
  const [rights, setRights] = useState(false);

  const save = async () => {
    const form = toForm(f);
    if (!canWrite) form.status = 'pending';
    const e = validatePlace(form);
    if (f.coords.trim() && !parseLatLng(f.coords)) e.push('Position illisible : collez « latitude, longitude » (copiée depuis Google Maps).');
    setErrors(e);
    if (e.length) return;
    await run(async () => {
      const row = {
        name: f.name.trim(), description: f.description.trim() || null, category_id: form.category_id, city: f.city.trim(), neighborhood: f.neighborhood.trim() || null, address: f.address.trim() || null,
        lat: form.lat, lng: form.lng, hours: f.hours.trim() || null, phone: f.phone.trim() || null, website: f.website.trim() || null, source_url: f.source_url.trim() || null,
        status: form.status, ...(canWrite ? { verification: f.verification, last_verified_at: f.last_verified_at } : {}),
      };
      let id = f.id;
      if (id) check(await sb.from('places').update(row).eq('id', id));
      else { const r = must(await sb.from('places').insert({ ...row, created_by: profile.id, is_demo: false }).select('id').single()) as { id: string }; id = r.id; }
      const price = { place_id: id, basis: f.basis, kind: f.basis === 'free' || f.basis === 'unknown' ? null : f.kind || null, min_amount: f.basis === 'free' || f.basis === 'unknown' ? null : form.min, max_amount: f.kind === 'range' ? form.max : null, extra_fees: form.extraFees, currency: 'XAF' };
      check(await sb.from('price_ranges').upsert(price, { onConflict: 'place_id' }));
      setF({ ...f, id });
    }, 'Lieu enregistré');
  };
  const upload = async (file: File | undefined) => {
    if (!file || !f.id) return;
    await run(async () => {
      const blob = await compressImage(file);
      const thumb = await compressImage(file, 480, 0.7); // vignette légère pour les listes de l'app
      const name = crypto.randomUUID();
      const path = `${f.id}/${name}.jpg`;
      check(await sb.storage.from('place-photos').upload(path, blob, { contentType: 'image/jpeg' }));
      check(await sb.storage.from('place-photos').upload(`${f.id}/${name}_t.jpg`, thumb, { contentType: 'image/jpeg' }));
      check(await sb.from('place_photos').insert({ place_id: f.id, storage_path: path, credit: credit.trim() || null, rights_confirmed: rights, sort: (photos.data?.length ?? 0) }));
      photos.reload();
    }, 'Photo ajoutée');
  };
  const removePhoto = (p: Photo) => run(async () => {
    check(await sb.storage.from('place-photos').remove([p.storage_path, p.storage_path.replace(/\.jpg$/i, '_t.jpg')]));
    check(await sb.from('place_photos').delete().eq('id', p.id));
    photos.reload();
  }, 'Photo supprimée');
  const togglePhoto = (p: Photo) => run(async () => { check(await sb.from('place_photos').update({ rights_confirmed: !p.rights_confirmed }).eq('id', p.id)); photos.reload(); }, 'Droits mis à jour');
  const showPrice = f.basis === 'per_person' || f.basis === 'per_group';

  return (
    <>
      <p><button onClick={onClose}>← Retour à la liste</button></p>
      <h1>{f.id ? 'Modifier le lieu' : 'Nouveau lieu'}</h1>
      <div className="card">
        <Field label="Nom *"><input value={f.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Description"><textarea value={f.description} disabled={readOnly} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="row">
          <Field label="Catégorie"><select value={f.category_id} disabled={readOnly} onChange={(e) => set('category_id', e.target.value)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label_fr}</option>)}</select></Field>
          <Field label="Ville *"><input value={f.city} disabled={readOnly} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="Quartier"><input value={f.neighborhood} disabled={readOnly} onChange={(e) => set('neighborhood', e.target.value)} /></Field>
        </div>
        <Field label="Adresse"><input value={f.address} disabled={readOnly} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Position : collez « latitude, longitude » (Google Maps : appui long sur le lieu, puis copier les coordonnées)">
          <input value={f.coords} disabled={readOnly} placeholder="-4.2634, 15.2429" onChange={(e) => set('coords', e.target.value)} />
        </Field>
        <div className="row">
          <button disabled={readOnly} onClick={() => navigator.geolocation.getCurrentPosition((p) => set('coords', `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`), () => setErrors(['Position indisponible sur cet appareil.']))}>Utiliser ma position</button>
          {parseLatLng(f.coords) && <a href={`https://www.openstreetmap.org/?mlat=${parseLatLng(f.coords)!.lat}&mlon=${parseLatLng(f.coords)!.lng}#map=17/${parseLatLng(f.coords)!.lat}/${parseLatLng(f.coords)!.lng}`} target="_blank" rel="noreferrer">Vérifier sur la carte ↗</a>}
        </div>
        <Field label="Horaires (texte libre, ex. Lun-Sam 10h-22h)"><input value={f.hours} disabled={readOnly} onChange={(e) => set('hours', e.target.value)} /></Field>
        <div className="row">
          <Field label="Téléphone professionnel (facultatif)"><input value={f.phone} disabled={readOnly} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Site officiel (https://…)"><input value={f.website} disabled={readOnly} onChange={(e) => set('website', e.target.value)} /></Field>
        </div>
        <Field label="Publication source (lien)"><input value={f.source_url} disabled={readOnly} onChange={(e) => set('source_url', e.target.value)} /></Field>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Prix</h2>
        <div className="row">
          <Field label="Type de prix"><select value={f.basis} disabled={readOnly} onChange={(e) => set('basis', e.target.value as F['basis'])}>
            <option value="unknown">Non communiqué</option><option value="free">Gratuit</option><option value="per_person">Par personne</option><option value="per_group">Par groupe</option></select></Field>
          {showPrice && <Field label="Nature du prix"><select value={f.kind} disabled={readOnly} onChange={(e) => set('kind', e.target.value)}>
            <option value="">—</option><option value="exact">Prix exact annoncé</option><option value="minimum">À partir de</option><option value="range">Fourchette</option><option value="estimated">Estimation (non confirmée)</option></select></Field>}
        </div>
        {showPrice && <div className="row">
          <Field label="Minimum (FCFA)"><input inputMode="numeric" value={f.min} disabled={readOnly} onChange={(e) => set('min', e.target.value)} /></Field>
          {f.kind === 'range' && <Field label="Maximum (FCFA)"><input inputMode="numeric" value={f.max} disabled={readOnly} onChange={(e) => set('max', e.target.value)} /></Field>}
          <Field label="Frais supplémentaires connus (FCFA)"><input inputMode="numeric" value={f.extra} disabled={readOnly} onChange={(e) => set('extra', e.target.value)} /></Field>
        </div>}
        <p className="muted">Un prix « estimation » est affiché comme tel dans l'app : ne le présentez jamais comme officiel.</p>
      </div>

      {canWrite && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Publication</h2>
          <div className="row">
            <Field label="État"><select value={f.status} onChange={(e) => set('status', e.target.value as Status)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Fiabilité des informations"><select value={f.verification} onChange={(e) => set('verification', e.target.value)}><option value="unverified">Non vérifiées</option><option value="declared">Déclaratives</option><option value="verified">Vérifiées</option></select></Field>
          </div>
          <p className="muted">Dernière vérification : {fmtDate(f.last_verified_at)}</p>
          <button onClick={() => setF({ ...f, last_verified_at: new Date().toISOString(), verification: 'verified' })}>Marquer vérifié aujourd'hui</button>
        </div>
      )}
      {!canWrite && <p className="muted">Votre lieu sera enregistré « en attente » : un administrateur le validera avant publication.</p>}
      <Errors list={errors} />
      <p><button className="primary" disabled={busy || readOnly} onClick={() => void save()}>Enregistrer</button></p>

      {canWrite && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Photos</h2>
          {!f.id ? <p className="muted">Enregistrez d'abord le lieu pour ajouter des photos.</p> : (
            <>
              <Loading s={photos} />
              {(photos.data ?? []).map((p) => (
                <div className="item" key={p.id}>
                  <div className="row" style={{ flexWrap: 'nowrap' }}><img className="thumb" src={publicUrl(sb, 'place-photos', p.storage_path)} alt="" /><div className="muted">{p.credit ?? 'Sans crédit'}<br />{p.rights_confirmed ? 'Droits confirmés' : 'Droits NON confirmés (photo masquée)'}</div></div>
                  <div className="row" style={{ flex: '0 0 auto' }}><button onClick={() => void togglePhoto(p)}>{p.rights_confirmed ? 'Retirer droits' : 'Confirmer droits'}</button><button className="danger" onClick={() => void removePhoto(p)}>Supprimer</button></div>
                </div>
              ))}
              <Field label="Crédit / auteur de la photo"><input value={credit} onChange={(e) => setCredit(e.target.value)} /></Field>
              <label><input type="checkbox" style={{ width: 'auto' }} checked={rights} onChange={(e) => setRights(e.target.checked)} /> Je détiens les droits (ou l'autorisation) de publier cette photo</label>
              <p><input type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} /></p>
              <p className="muted">Les photos sont réduites automatiquement (1600 px) pour les connexions lentes. Sans droits confirmés, elles ne sont pas montrées au public.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
