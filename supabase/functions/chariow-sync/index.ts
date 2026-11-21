// Réservée aux administrateurs : relève le produit chez Chariow, recopie son prix dans l'offre et signale les problèmes.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.chariow.com/v1';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string, d = '') => Deno.env.get(k) ?? d;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Connexion requise.' }, 401);
    const { data: me } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
    if (!['admin', 'super_admin'].includes(String(me?.role))) return json({ error: 'Accès refusé.' }, 403);

    const apiKey = env('CHARIOW_API_KEY'), productId = env('CHARIOW_PRODUCT_ID'), planId = env('CHARIOW_PLAN_ID', 'month');
    if (!apiKey || !productId) return json({ error: 'Secrets CHARIOW_API_KEY et CHARIOW_PRODUCT_ID à renseigner dans Supabase.' }, 400);
    const pr = await fetch(`${API}/products/${encodeURIComponent(productId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!pr.ok) return json({ error: `Chariow a répondu ${pr.status} (clé, droit « products.read » ou identifiant produit ?).` }, 502);
    const p = (await pr.json().catch(() => ({})))?.data;
    const price = Number(p?.pricing?.current_price?.value), cur = String(p?.pricing?.current_price?.currency ?? '');
    const warnings: string[] = [];
    if (p?.type !== 'license') warnings.push('Le produit doit être de type Licence : sinon un utilisateur ne pourra pas renouveler (« déjà acheté »).');
    if (p?.status !== 'published') warnings.push("Le produit n'est pas publié.");
    if (p?.pricing?.type !== 'one_time') warnings.push('Le prix doit être « paiement unique ».');
    if (p?.has_variant_pricing) warnings.push('Des variantes de prix existent : Balade utilise toujours le prix de base.');
    if (p?.pricing?.sale_price) warnings.push("Une promotion est active : Balade applique le prix promotionnel tant qu'elle dure.");
    if (!['XAF', 'XOF'].includes(cur)) warnings.push(`Devise ${cur} : vérifiez qu'elle convient (FCFA attendu).`);
    if (price > 0) await admin.from('premium_plans').update({ price: Math.round(price), currency: cur }).eq('id', planId);
    const { data: plan } = await admin.from('premium_plans').select('days').eq('id', planId).maybeSingle();
    return json({ name: p?.name, type: p?.type, status: p?.status, price, currency: cur, days: plan?.days, warnings });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
});
