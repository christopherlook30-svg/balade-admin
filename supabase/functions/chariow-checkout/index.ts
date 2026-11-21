// Crée une vente Chariow pour l'utilisateur connecté. Le prix n'est JAMAIS lu depuis le téléphone :
// il est relevé chez Chariow, recopié dans l'offre, puis comparé au montant de la vente créée.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.chariow.com/v1';
const FCFA = ['XAF', 'XOF'];
const sameCurrency = (a: string, b: string) => a === b || (FCFA.includes(a) && FCFA.includes(b));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string, d = '') => Deno.env.get(k) ?? d;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Connectez-vous pour continuer.' }, 401);
    const uid = u.user.id;
    const body = await req.json().catch(() => ({}));

    const apiKey = env('CHARIOW_API_KEY'), productId = env('CHARIOW_PRODUCT_ID'), planId = env('CHARIOW_PLAN_ID', 'month');
    if (!apiKey || !productId) { console.error('CHARIOW_API_KEY ou CHARIOW_PRODUCT_ID manquant'); return json({ error: 'Paiement indisponible pour le moment.' }, 503); }
    const { data: st } = await admin.from('app_settings').select('value').eq('key', 'premium_provider').maybeSingle();
    if (st?.value !== 'chariow') return json({ error: "Le paiement n'est pas ouvert pour le moment." }, 403);

    // 1) Prix réel chez Chariow, recopié dans l'offre
    const pr = await fetch(`${API}/products/${encodeURIComponent(productId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!pr.ok) { console.error('Chariow product', pr.status); return json({ error: 'Paiement indisponible pour le moment.' }, 502); }
    const p = (await pr.json().catch(() => ({})))?.data;
    const price = Number(p?.pricing?.current_price?.value);
    const cur = String(p?.pricing?.current_price?.currency ?? '');
    if (p?.status !== 'published' || p?.pricing?.type !== 'one_time' || !(price > 0)) { console.error('Produit Chariow inutilisable', p?.status, p?.pricing?.type, price); return json({ error: 'Offre indisponible pour le moment.' }, 503); }
    await admin.from('premium_plans').update({ price: Math.round(price), currency: cur }).eq('id', planId);
    // Le téléphone indique seulement le prix qu'il affichait : s'il est périmé, on le prévient sans créer de vente.
    if (body.seen_price !== undefined && Number(body.seen_price) !== price) return json({ error: 'price_changed', price, currency: cur }, 409);

    // 2) Anti-abus : 3 ventes en attente maximum sur 10 minutes
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from('chariow_sales').select('sale_id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'awaiting_payment').gte('created_at', since);
    if ((count ?? 0) >= 3) return json({ error: 'Trop de demandes. Réessayez dans quelques minutes.' }, 429);

    // 3) Client
    let num = String(body.phone ?? '').replace(/\D/g, '');
    const dial = env('CHARIOW_DIAL', '242');
    if (num.startsWith(dial) && num.length > 9) num = num.slice(dial.length);
    if (env('CHARIOW_STRIP_ZERO') === '1' && num.startsWith('0')) num = num.slice(1);
    if (num.length < 6 || num.length > 15) return json({ error: 'Numéro de téléphone invalide.' }, 400);
    const { data: prof } = await admin.from('profiles').select('display_name').eq('id', uid).maybeSingle();
    const parts = String(prof?.display_name ?? '').trim().split(/\s+/).filter(Boolean);
    const first = (parts[0] ?? 'Client').slice(0, 50);
    const last = (parts.slice(1).join(' ') || 'Balade').slice(0, 50);
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();

    // 4) Vente Chariow
    const cr = await fetch(`${API}/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId, email: u.user.email, first_name: first, last_name: last,
        phone: { number: num, country_code: env('CHARIOW_COUNTRY', 'CG') },
        redirect_url: env('RETURN_URL') || undefined,
        customer_ip: /^[0-9a-f.:]+$/i.test(ip) ? ip : undefined,
        custom_metadata: { app: 'balade', user_id: uid, plan_id: planId },
      }),
    });
    const out = await cr.json().catch(() => ({}));
    if (!cr.ok) {
      console.error('Chariow checkout', cr.status, JSON.stringify(out).slice(0, 300));
      const phoneIssue = /phone/i.test(String(out?.message ?? ''));
      return json({ error: phoneIssue ? 'Numéro de téléphone invalide pour ce pays.' : cr.status === 429 ? 'Trop de demandes. Réessayez dans un instant.' : 'Paiement indisponible pour le moment.' }, cr.status === 429 ? 429 : 502);
    }
    const d = out?.data;
    if (d?.step === 'already_purchased') { console.error('already_purchased : le produit Chariow doit être de type Licence'); return json({ error: 'Renouvellement impossible pour le moment.' }, 503); }
    const pur = d?.purchase;
    const amt = Number(pur?.amount?.value), acur = String(pur?.amount?.currency ?? '');
    // 5) Garde-fou : le montant de la vente doit être exactement le prix de l'offre
    if (d?.step !== 'payment' || !d?.payment?.checkout_url || !pur?.id || amt !== price || !sameCurrency(acur, cur)) {
      console.error('Montant inattendu', d?.step, amt, acur, price, cur);
      await admin.from('chariow_alerts').insert({ kind: 'checkout_mismatch', message: `Vente ${pur?.id ?? '?'} : ${amt} ${acur} au lieu de ${price} ${cur}`, sale_id: pur?.id ?? null });
      return json({ error: 'Le prix est en cours de mise à jour. Réessayez dans un instant.' }, 409);
    }
    const ins = await admin.from('chariow_sales').insert({ sale_id: pur.id, user_id: uid, plan_id: planId, expected_amount: amt, expected_currency: acur });
    if (ins.error) throw ins.error; // pas de lien de paiement sans vente enregistrée
    return json({ sale_id: pur.id, url: d.payment.checkout_url, price, currency: cur });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
});
