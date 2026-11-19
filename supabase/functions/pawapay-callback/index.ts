// Reçoit la notification PawaPay. On ne se fie jamais au contenu reçu : on redemande l'état du paiement à PawaPay.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const id: string | undefined = body?.depositId ?? body?.data?.depositId;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('ignored');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: pay } = await admin.from('premium_payments').select('deposit_id').eq('deposit_id', id).maybeSingle();
    if (!pay) return new Response('ignored');

    const base = Deno.env.get('PAWAPAY_BASE') ?? 'https://api.sandbox.pawapay.io';
    const r = await fetch(`${base}/v2/deposits/${id}`, { headers: { Authorization: `Bearer ${Deno.env.get('PAWAPAY_TOKEN')}` } });
    const j = await r.json().catch(() => ({}));
    const status: string | undefined = j?.data?.status ?? j?.status;
    if (status === 'COMPLETED') {
      const { error } = await admin.rpc('grant_premium_payment', { p_deposit: id });
      if (error) throw error;
    } else if (status === 'FAILED' || status === 'REJECTED') {
      await admin.from('premium_payments').update({ status: 'failed' }).eq('deposit_id', id).eq('status', 'pending');
    }
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 }); // PawaPay réessaiera
  }
});
