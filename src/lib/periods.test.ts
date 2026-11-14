import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctr, delta, periodRange, toCsv } from './periods.ts';

test('7 derniers jours et période précédente de même longueur', () => {
  const p = periodRange('7d', '2026-11-10');
  assert.deepEqual(p.cur, { from: '2026-11-04', to: '2026-11-10' });
  assert.deepEqual(p.prev, { from: '2026-10-28', to: '2026-11-03' });
});
test('ce mois-ci : comparaison avec le même nombre de jours du mois précédent', () => {
  const p = periodRange('month', '2026-11-10');
  assert.deepEqual(p.cur, { from: '2026-11-01', to: '2026-11-10' });
  assert.deepEqual(p.prev, { from: '2026-10-01', to: '2026-10-10' });
  assert.equal(p.days, 10);
});
test('ce mois-ci en fin de mois long, mois précédent plus court', () => {
  const p = periodRange('month', '2026-03-31');
  assert.deepEqual(p.prev, { from: '2026-02-01', to: '2026-02-28' });
});
test('mois dernier, y compris en janvier', () => {
  assert.deepEqual(periodRange('lastmonth', '2026-11-10').cur, { from: '2026-10-01', to: '2026-10-31' });
  const j = periodRange('lastmonth', '2026-01-15');
  assert.deepEqual(j.cur, { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(j.prev, { from: '2025-11-01', to: '2025-11-30' });
  assert.equal(j.days, 31);
});
test('évolution et taux de clic', () => {
  assert.equal(delta(150, 100), '+50 %');
  assert.equal(delta(50, 100), '-50 %');
  assert.equal(delta(0, 0), '—');
  assert.equal(delta(5, 0), 'nouveau');
  assert.equal(ctr(38, 1240), '3,1 %');
  assert.equal(ctr(0, 0), '—');
});
test('CSV avec guillemets échappés', () => {
  assert.equal(toCsv([['Titre', 'Clics'], ['Pizza "Mama"', 38]]), '"Titre";"Clics"\n"Pizza ""Mama""";38');
});
