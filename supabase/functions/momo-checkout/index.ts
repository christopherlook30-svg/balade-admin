// MTN MoMo (API Collection) : envoie une demande de paiement sur le téléphone du client.
// Appelée par l'application avec le jeton de l'utilisateur. Secrets attendus : voir docs/GUIDE_PREMIUM.md.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string, d = '') => Deno.env.get(k) ?? d;

/** Numéro au format international. Bac à sable : chiffres tels quels. Production : préfixe pays (242) ajouté si absent. */
function msisdn(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return null;
  if (env('MOMO_ENV', 'sandbox') === 'sandbox') return d;
  const prefix = env('MOMO_COUNTRY_PREFIX', '242');
  if (!d.startsWith(prefix)) d = prefix + d;
  if (env('MOMO_STRIP_ZERO') === '1' && d.startsWith(prefix + '0')) d = prefix + d.slice(prefix.length + 1);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Connectez-vous pour continuer.' }, 401);

    const body = await req.json().catch(() => ({}));
    const phone = msisdn(body.phone);
    if (!phone) return json({ error: 'Numéro MTN invalide.' }, 400);
    const { data: plan } = await admin.from('premium_plans').select('id,label,price,active').eq('id', body.plan_id).maybeSingle();
    if (!plan || !plan.active) return json({ error: 'Offre introuvable.' }, 400);

    // Anti-abus : 3 demandes en attente au maximum sur 10 minutes.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from('premium_payments').select('deposit_id', { count: 'exact', head: true }).eq('user_id', u.user.id).eq('status', 'pending').gte('created_at', since);
    if ((count ?? 0) >= 3) return json({ error: 'Trop de demandes. Réessayez dans quelques minutes.' }, 429);

    const base = env('MOMO_BASE', 'https://sandbox.momodeveloper.mtn.com');
    const target = env('MOMO_ENV', 'sandbox');
    const currency = env('MOMO_CURRENCY', target === 'sandbox' ? 'EUR' : 'XAF');
    const subKey = env('MOMO_SUBSCRIPTION_KEY');

    const tr = await fetch(`${base}/collection/token/`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${env('MOMO_API_USER')}:${env('MOMO_API_KEY')}`), 'Ocp-Apim-Subscription-Key': subKey },
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) { console.error('MoMo token', tr.status); return json({ error: 'Paiement indisponible pour le moment.' }, 502); }

    const reference = crypto.randomUUID();
    const ins = await admin.from('premium_payments').insert({ deposit_id: reference, user_id: u.user.id, plan_id: plan.id, amount: plan.price, currency });
    if (ins.error) throw ins.error;

    const r = await fetch(`${base}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tj.access_token}`, 'X-Reference-Id': reference, 'X-Target-Environment': target,
        'Ocp-Apim-Subscription-Key': subKey, 'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(plan.price), currency, externalId: reference,
        payer: { partyIdType: 'MSISDN', partyId: phone },
        payerMessage: `Balade Premium ${plan.label}`.slice(0, 50), payeeNote: 'Balade Premium',
      }),
    });
    if (r.status !== 202) {
      const out = await r.json().catch(() => ({}));
      console.error('MoMo requesttopay', r.status, JSON.stringify(out));
      await admin.from('premium_payments').update({ status: 'failed' }).eq('deposit_id', reference);
      const noAccount = JSON.stringify(out).includes('PAYER_NOT_FOUND');
      return json({ error: noAccount ? "Ce numéro n'a pas de compte MTN Mobile Money." : 'La demande de paiement a été refusée.' }, 502);
    }
    return json({ reference });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
});
