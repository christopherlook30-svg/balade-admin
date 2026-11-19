// Crée une page de paiement PawaPay pour l'offre choisie. Appelée par l'application (jeton utilisateur).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Connectez-vous pour continuer.' }, 401);
    const { plan_id } = await req.json();
    const { data: plan } = await admin.from('premium_plans').select('id,label,days,price,currency,active').eq('id', plan_id).maybeSingle();
    if (!plan || !plan.active) return json({ error: 'Offre introuvable.' }, 400);

    const depositId = crypto.randomUUID();
    const ins = await admin.from('premium_payments').insert({ deposit_id: depositId, user_id: u.user.id, plan_id: plan.id, amount: plan.price, currency: plan.currency });
    if (ins.error) throw ins.error;

    const base = Deno.env.get('PAWAPAY_BASE') ?? 'https://api.sandbox.pawapay.io'; // production : https://api.pawapay.io
    const r = await fetch(`${base}/v2/paymentpage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('PAWAPAY_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        depositId,
        returnUrl: Deno.env.get('RETURN_URL'),
        reason: `Balade Premium ${plan.label}`.slice(0, 50),
        amountDetails: { amount: String(plan.price), currency: plan.currency },
        country: Deno.env.get('PAWAPAY_COUNTRY') ?? 'CMR',
        language: 'FR',
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.redirectUrl) {
      console.error('PawaPay', r.status, JSON.stringify(out));
      await admin.from('premium_payments').update({ status: 'failed' }).eq('deposit_id', depositId);
      return json({ error: 'Paiement indisponible pour le moment.' }, 502);
    }
    return json({ url: out.redirectUrl });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
});
