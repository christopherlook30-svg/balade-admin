# Premium avec Chariow : mise en service

Ordre à suivre. Rien n'est supprimé : l'attribution manuelle et le paiement MTN direct restent disponibles.

## 1. Base de données
SQL Editor Supabase : lancez `supabase/migrations/0009_chariow.sql`. Le moyen de paiement est « Fermé » par défaut.

## 2. Produit Chariow
Produit « Balade Premium 30 jours » : type **Licence**, mode **sans activation**, validité 30 jours, clés générées automatiquement, prix en FCFA, publié.
Pour retrouver son identifiant (`prd_…`), depuis un terminal (la clé reste chez vous) :
`curl -H "Authorization: Bearer VOTRE_CLE" https://api.chariow.com/v1/products`

## 3. Fonctions du serveur (Supabase → Edge Functions → « Via Editor »)
| Fonction | Verify JWT |
|---|---|
| `chariow-checkout` | activé |
| `chariow-status` | activé |
| `chariow-sync` | activé |
| `chariow-pulse` | **désactivé** |

Collez le contenu de `supabase/functions/<nom>/index.ts` dans chacune.

## 4. Secrets (Edge Functions → Secrets)
- `CHARIOW_API_KEY` : la clé API (droits `checkout.write`, `sales.read`, `products.read`)
- `CHARIOW_PRODUCT_ID` : l'identifiant du produit (`prd_…`)
- `RETURN_URL` : `https://christopherlook30-svg.github.io/balade-admin/premium-merci.html`
- Facultatifs : `CHARIOW_COUNTRY` (défaut `CG`), `CHARIOW_PLAN_ID` (défaut `month`), `CHARIOW_STRIP_ZERO` = `1` si Chariow refuse le 0 initial du numéro.

## 5. Notifications (Pulse) dans Chariow
Automatisation → Pulses → nouveau :
- URL : `https://<votre-projet>.supabase.co/functions/v1/chariow-pulse`
- Événements : `successful.sale`, `failed.sale`, `abandoned.sale` ; produit : Premium
- Copiez le secret `whsec_…` affiché, puis ajoutez-le dans Supabase : `CHARIOW_PULSE_SECRET`
- « Send test pulse » : la livraison doit apparaître avec la réponse 200.

## 6. Admin
Publiez le site admin, ouvrez Premium, touchez « Synchroniser avec Chariow » : lisez les avertissements (type Licence, publication, devise), puis choisissez « Chariow » comme moyen de paiement.

## 7. Prix
Changez-le dans Chariow : Balade le relit à chaque achat. Un utilisateur qui voyait l'ancien prix est prévenu avant de payer.

## 8. Essai réel
Aucun bac à sable n'est documenté : faites un vrai achat au plus petit prix, puis contrôlez `chariow_sales` (statut « completed »), `premium_grants` et `profiles.premium_until`.
Une vente payée en dehors de l'application, ou dont le montant diffère, apparaît dans « Anomalies » de la page Premium.
