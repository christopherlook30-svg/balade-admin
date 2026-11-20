// MTN MoMo : vérifie l'état d'un paiement auprès de MTN et active Premium s'il est réussi.
// Sans « reference », règle les paiements en attente des dernières 24 h de l'utilisateur (si l'app a été fermée).
import { createClient } from 'npm:@supabase/supabase-js@2';

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
    const body = await req.json().catch(() => ({}));

    let rows: { deposit_id: string; amount: number; currency: string; status: string }[] = [];
    if (body.reference) {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.reference))) return json({ error: 'Référence invalide.' }, 400);
      const { data } = await admin.from('premium_payments').select('deposit_id,amount,currency,status').eq('deposit_id', body.reference).eq('user_id', u.user.id);
      rows = data ?? [];
      if (rows.length === 0) return json({ error: 'Paiement introuvable.' }, 404);
      if (rows[0].status !== 'pending') return json({ status: rows[0].status });
    } else {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await admin.from('premium_payments').select('deposit_id,amount,currency,status').eq('user_id', u.user.id).eq('status', 'pending').gte('created_at', since).order('created_at', { ascending: false }).limit(5);
      rows = data ?? [];
      if (rows.length === 0) return json({ status: 'none' });
    }

    const base = env('MOMO_BASE', 'https://sandbox.momodeveloper.mtn.com');
    const target = env('MOMO_ENV', 'sandbox');
    const subKey = env('MOMO_SUBSCRIPTION_KEY');
    const tr = await fetch(`${base}/collection/token/`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${env('MOMO_API_USER')}:${env('MOMO_API_KEY')}`), 'Ocp-Apim-Subscription-Key': subKey },
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) { console.error('MoMo token', tr.status); return json({ status: 'pending' }); }

    let result = 'pending';
    let reason = '';
    for (const p of rows) {
      const r = await fetch(`${base}/collection/v1_0/requesttopay/${p.deposit_id}`, {
        headers: { Authorization: `Bearer ${tj.access_token}`, 'X-Target-Environment': target, 'Ocp-Apim-Subscription-Key': subKey },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.error('MoMo status', r.status); continue; }
      const st = String(j.status ?? '').toUpperCase();
      if (st === 'SUCCESSFUL') {
        // Le montant et la devise confirmés par MTN doivent correspondre à l'offre choisie.
        if ((j.amount !== undefined && Number(j.amount) !== p.amount) || (j.currency && j.currency !== p.currency)) { console.error('MoMo montant inattendu', p.deposit_id); continue; }
        const { error } = await admin.rpc('grant_premium_payment', { p_deposit: p.deposit_id });
        if (error) throw error;
        result = 'completed';
      } else if (st === 'FAILED' || st === 'REJECTED' || st === 'TIMEOUT') {
        // Le détail de l'échec (ex. numéro sans compte MTN) est dans « reason ».
        reason = typeof j.reason === 'string' ? j.reason : String(j.reason?.code ?? '');
        await admin.from('premium_payments').update({ status: 'failed' }).eq('deposit_id', p.deposit_id).eq('status', 'pending');
        if (result !== 'completed') result = 'failed';
      }
    }
    return json({ status: result, reason });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
});
