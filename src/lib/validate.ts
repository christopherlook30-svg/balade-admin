/** Validations pures (testées) utilisées par l'administration. */

export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.replace(/[()°]/g, ' ').replace(/−/g, '-').match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]!.replace(',', '.'));
  const lng = Number(m[2]!.replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function isSafeLink(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url) || /^tel:\+?[0-9 ]{6,20}$/.test(url);
}

export function slugify(label: string): string {
  return label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Lit le rôle contenu dans une clé Supabase (JWT). Sert à refuser une clé « service_role ». */
export function jwtRole(key: string): string | null {
  try {
    const part = key.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export function validateConfig(url: string, key: string): string | null {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim())) return "L'adresse doit ressembler à https://xxxx.supabase.co";
  const role = jwtRole(key.trim());
  if (role === 'service_role') return 'Cette clé est la clé secrète (service_role) : ne la mettez JAMAIS ici. Utilisez la clé « anon ».';
  if (role !== 'anon') return "Clé invalide : utilisez la clé publique « anon » (une longue clé commençant par eyJ).";
  return null;
}

export interface PlaceForm {
  name: string; city: string; category_id: number | null; lat: number | null; lng: number | null;
  status: 'draft' | 'pending' | 'published' | 'archived';
  basis: 'per_person' | 'per_group' | 'free' | 'unknown'; kind: 'exact' | 'minimum' | 'range' | 'estimated' | null;
  min: number | null; max: number | null; extraFees: number; website: string; phone: string;
}
export function validatePlace(f: PlaceForm): string[] {
  const e: string[] = [];
  if (f.name.trim().length < 2) e.push('Le nom doit faire au moins 2 caractères.');
  if (!f.city.trim()) e.push('La ville est obligatoire.');
  if ((f.lat === null) !== (f.lng === null)) e.push('Renseignez la latitude ET la longitude.');
  if (f.status === 'published') {
    if (f.lat === null || f.lng === null) e.push('Un lieu publié doit avoir une position (latitude et longitude).');
    if (f.category_id === null) e.push('Un lieu publié doit avoir une catégorie.');
  }
  if (f.basis === 'per_person' || f.basis === 'per_group') {
    if (!f.kind) e.push('Précisez le type de prix (exact, à partir de, fourchette, estimé).');
    if (f.min === null || f.min < 0) e.push('Le prix minimum est obligatoire (0 ou plus).');
    if (f.kind === 'range' && (f.max === null || (f.min !== null && f.max < f.min))) e.push('Pour une fourchette, le maximum doit être supérieur ou égal au minimum.');
  }
  if (f.extraFees < 0) e.push('Les frais supplémentaires ne peuvent pas être négatifs.');
  if (f.website && !/^https:\/\//i.test(f.website)) e.push('Le site doit commencer par https://');
  return e;
}

export interface AdForm {
  title: string; body: string; cta: string; link: string; video: string; weight: number;
  starts: string; ends: string; placement: string;
}
export function validateAd(f: AdForm): string[] {
  const e: string[] = [];
  if (!f.title.trim() || f.title.length > 60) e.push('Le titre est obligatoire (60 caractères maximum).');
  if (f.body.length > 140) e.push('Le texte ne doit pas dépasser 140 caractères.');
  if (f.cta.length > 20) e.push('Le texte du bouton ne doit pas dépasser 20 caractères.');
  if (f.link && !isSafeLink(f.link)) e.push('Le lien doit commencer par https:// (ou tel: pour un numéro).');
  if (f.video && !/^https:\/\/[^\s]+$/i.test(f.video)) e.push('Le lien vidéo doit commencer par https://');
  if (!Number.isInteger(f.weight) || f.weight < 1 || f.weight > 10) e.push('La priorité doit être un entier de 1 à 10.');
  if (!['banner', 'popup', 'list', 'map_pin'].includes(f.placement)) e.push('Emplacement inconnu.');
  if (f.starts && f.ends && f.ends < f.starts) e.push('La date de fin doit suivre la date de début.');
  return e;
}
