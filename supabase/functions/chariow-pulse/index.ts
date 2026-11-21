// Reçoit les notifications Chariow (Pulse). Chaque livraison est vérifiée (signature HMAC-SHA256 du corps brut),
// dédoublonnée, puis la vente est RELUE chez Chariow avant toute activation : le contenu reçu n'est jamais cru tel quel.
// « Verify JWT » doit être désactivé pour cette fonction (Chariow n'a pas de jeton Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.chariow.com/v1';
const FCFA = ['XAF', 'XOF']; // même monnaie, deux codes
const sameCurrency = (a: string, b: string) => a === b || (FCFA.includes(a) && FCFA.includes(b));
// deno-lint-ignore no-explicit-any
type DB = any;

/** Relit la vente chez Chariow et n'active Premium que si tout correspond. Renvoie l'état de NOTRE vente. */
async function settleSale(admin: DB, saleId: string): Promise<{ status: string; message?: string }> {
  const { data: row } = await admin.from('chariow_sales').select('sale_id,status,expected_currency,failure_message').eq('sale_id', saleId).maybeSingle();
  if (!row) return { status: 'unknown' };
  if (row.status === 'completed' || row.status === 'mismatch') return { status: row.status };
  const r = await fetch(`${API}/sales/${encodeURIComponent(saleId)}`, { headers: { Authorization: `Bearer ${Deno.env.get('CHARIOW_API_KEY')}` } });
  if (!r.ok) { console.error('Chariow sale', r.status); return { status: row.status }; }
  const s = (await r.json().catch(() => ({})))?.data;
  if (!s) return { status: row.status };
  const flag = async (kind: string, message: string) => {
    await admin.from('chariow_alerts').insert({ kind, message, sale_id: saleId });
    await admin.from('chariow_sales').update({ status: 'mismatch' }).eq('sale_id', saleId);
    return { status: 'mismatch' };
  };
  if (s.product?.id !== Deno.env.get('CHARIOW_PRODUCT_ID')) return await flag('wrong_product', `Produit inattendu : ${s.product?.id}`);
  if (s.status === 'failed') {
    const msg = s.payment?.failure_error?.customer_message ?? null;
    await admin.from('chariow_sales').update({ status: 'failed', failure_message: msg }).eq('sale_id', saleId);
    return { status: 'failed', message: msg ?? undefined };
  }
  if (s.status === 'abandoned') { await admin.from('chariow_sales').update({ status: 'abandoned' }).eq('sale_id', saleId); return { status: 'abandoned' }; }
  // Paiement réellement abouti, accès non révoqué ; un retour « terminé » du navigateur ne suffit jamais.
  if (!['completed', 'settled'].includes(String(s.status)) || s.payment?.status !== 'success' || s.is_access_revoked) return { status: 'awaiting_payment' };
  if (!sameCurrency(String(s.amount?.currency), row.expected_currency)) return await flag('currency', `Devise payée ${s.amount?.currency} ≠ ${row.expected_currency}`);
  const { data, error } = await admin.rpc('grant_premium_chariow', { p_sale: saleId, p_amount: Number(s.amount?.value), p_currency: String(s.amount?.currency) });
  if (error) throw error;
  return { status: data === 'mismatch' ? 'mismatch' : 'completed' };
}

async function hmacHex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const ok = (t = 'OK') => new Response(t, { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('CHARIOW_PULSE_SECRET');
  if (!secret) { console.error('CHARIOW_PULSE_SECRET manquant'); return new Response('Not configured', { status: 500 }); }
  const raw = new Uint8Array(await req.arrayBuffer()); // octets exacts : jamais re-sérialisés
  const expected = 'sha256=' + (await hmacHex(secret, raw));
  if (!safeEqual(req.headers.get('x-chariow-signature') ?? '', expected)) return new Response('Invalid signature', { status: 401 });

  // À partir d'ici la signature est valide : on répond toujours 2xx (5 échecs de suite désactivent le Pulse chez Chariow).
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const deliveryId = req.headers.get('x-pulse-delivery-id') || `no-id-${crypto.randomUUID()}`;
  // deno-lint-ignore no-explicit-any
  let payload: any = null;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return ok('ignored'); }
  const event = req.headers.get('x-pulse-event') ?? String(payload?.event ?? '');
  const saleId = String(payload?.sale?.id ?? '');

  const { data: prev } = await admin.from('chariow_deliveries').select('outcome').eq('delivery_id', deliveryId).maybeSingle();
  if (prev && prev.outcome !== 'error') return ok('duplicate');
  await admin.from('chariow_deliveries').upsert({ delivery_id: deliveryId, event, sale_id: saleId || null, outcome: 'received' });

  let outcome = 'ignored';
  try {
    if (['successful.sale', 'failed.sale', 'abandoned.sale'].includes(event) && saleId && !saleId.startsWith('test_')) {
      const res = await settleSale(admin, saleId);
      outcome = `processed:${res.status}`;
      if (res.status === 'unknown' && event === 'successful.sale') {
        await admin.from('chariow_alerts').insert({ kind: 'unknown_sale', message: `Vente ${saleId} payée sans passer par l'application (aucun compte lié).`, sale_id: saleId });
      }
    }
  } catch (e) {
    console.error(e);
    outcome = 'error';
  }
  await admin.from('chariow_deliveries').update({ outcome }).eq('delivery_id', deliveryId);
  return ok();
});
