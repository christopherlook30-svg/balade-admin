// Vérifie une vente auprès de Chariow et active Premium si le paiement est réel et correct.
// Sans « sale_id », règle les ventes en attente des dernières 24 h de l'utilisateur (app fermée trop tôt, notification en retard).
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

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Connectez-vous pour continuer.' }, 401);
    const body = await req.json().catch(() => ({}));

    if (body.sale_id) {
      const id = String(body.sale_id);
      const { data: row } = await admin.from('chariow_sales').select('sale_id').eq('sale_id', id).eq('user_id', u.user.id).maybeSingle();
      if (!row) return json({ error: 'Paiement introuvable.' }, 404);
      return json(await settleSale(admin, id));
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: rows } = await admin.from('chariow_sales').select('sale_id').eq('user_id', u.user.id).eq('status', 'awaiting_payment').gte('created_at', since).order('created_at', { ascending: false }).limit(5);
    if (!rows?.length) return json({ status: 'none' });
    let result = 'awaiting_payment';
    for (const r of rows) { const s = await settleSale(admin, r.sale_id); if (s.status === 'completed') result = 'completed'; }
    return json({ status: result });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
});
