import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeLink, jwtRole, parseLatLng, slugify, validateAd, validateConfig, validatePlace, type AdForm, type PlaceForm } from './validate.ts';
import { can } from './permissions.ts';

const place = (o: Partial<PlaceForm> = {}): PlaceForm => ({
  name: 'Chez Maman', city: 'Brazzaville', category_id: 1, lat: -4.26, lng: 15.24, status: 'published',
  basis: 'per_person', kind: 'exact', min: 3000, max: null, extraFees: 0, website: '', phone: '', ...o,
});
const ad = (o: Partial<AdForm> = {}): AdForm => ({ title: 'Promo', body: '', cta: 'Voir', link: 'https://exemple.cg', video: '', weight: 1, starts: '', ends: '', placement: 'banner', ...o });
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('coordonnées collées depuis Google Maps', () => {
  assert.deepEqual(parseLatLng('-4.2634, 15.2429'), { lat: -4.2634, lng: 15.2429 });
  assert.deepEqual(parseLatLng('(-4,2634 ; 15,2429)'), { lat: -4.2634, lng: 15.2429 });
  assert.equal(parseLatLng('95, 10'), null);
  assert.equal(parseLatLng('abc'), null);
});
test('liens autorisés : https et tel seulement', () => {
  assert.ok(isSafeLink('https://wa.me/242060000000'));
  assert.ok(isSafeLink('tel:+242060000000'));
  assert.ok(!isSafeLink('http://exemple.cg'));
  assert.ok(!isSafeLink('javascript:alert(1)'));
});
test('slug', () => assert.equal(slugify('Détente & Spa !'), 'detente-spa'));
test('clé secrète service_role refusée, clé anon acceptée', () => {
  const url = 'https://abcd.supabase.co';
  assert.equal(jwtRole(`x.${b64({ role: 'anon' })}.y`), 'anon');
  assert.match(validateConfig(url, `x.${b64({ role: 'service_role' })}.y`) ?? '', /secrète/);
  assert.equal(validateConfig(url, `x.${b64({ role: 'anon' })}.y`), null);
  assert.ok(validateConfig('http://autre.com', 'zzz'));
});
test('lieu valide et lieux invalides', () => {
  assert.deepEqual(validatePlace(place()), []);
  assert.ok(validatePlace(place({ lat: null, lng: null })).length > 0);
  assert.equal(validatePlace(place({ lat: null, lng: null, status: 'draft' })).length, 0);
  assert.ok(validatePlace(place({ lat: -4, lng: null, status: 'draft' })).length > 0);
  assert.ok(validatePlace(place({ min: null })).length > 0);
  assert.ok(validatePlace(place({ kind: 'range', min: 5000, max: 3000 })).length > 0);
  assert.equal(validatePlace(place({ basis: 'unknown', kind: null, min: null })).length, 0);
  assert.ok(validatePlace(place({ website: 'http://x.cg' })).length > 0);
});
test('annonce valide et invalides', () => {
  assert.deepEqual(validateAd(ad()), []);
  assert.ok(validateAd(ad({ title: '' })).length > 0);
  assert.ok(validateAd(ad({ link: 'javascript:x' })).length > 0);
  assert.ok(validateAd(ad({ weight: 11 })).length > 0);
  assert.ok(validateAd(ad({ starts: '2026-12-01', ends: '2026-11-01' })).length > 0);
  assert.ok(validateAd(ad({ body: 'x'.repeat(141) })).length > 0);
});
test('permissions par rôle', () => {
  assert.ok(can('super_admin', 'users.manage') && !can('admin', 'users.manage'));
  assert.ok(can('moderator', 'places.moderate') && !can('moderator', 'places.write'));
  assert.ok(can('creator', 'places.propose') && !can('creator', 'ads.manage'));
  assert.ok(!can('user', 'dashboard.view'));
  assert.ok(can('admin', 'ads.manage') && !can('moderator', 'ads.manage'));
});
