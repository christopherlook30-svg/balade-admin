# Premium, PawaPay et régie publicitaire

## 1. Base de données (SQL Editor Supabase)
1. Lancez `supabase/migrations/0008_premium_profil.sql`.
2. Prix des offres : table `premium_plans` (Table Editor) : `price`, `days`, `active`.

## 2. PawaPay (compte marchand + jeton API)
Supabase → Edge Functions → créez `pawapay-checkout` et `pawapay-callback` (collez les fichiers de `supabase/functions/`).
- `pawapay-callback` : désactivez « Verify JWT ».
- Secrets (Edge Functions → Secrets) : `PAWAPAY_TOKEN`, `PAWAPAY_BASE` (`https://api.sandbox.pawapay.io` pour tester, `https://api.pawapay.io` en production), `PAWAPAY_COUNTRY` (ex. `CMR`), `RETURN_URL` = `https://christopherlook30-svg.github.io/balade-admin/premium-merci.html`.
- Dans le tableau de bord PawaPay : URL de rappel des dépôts = `https://<votre-projet>.supabase.co/functions/v1/pawapay-callback`.
- Testez d'abord en sandbox. Vérifiez dans la doc PawaPay (`/v2/paymentpage`) les champs acceptés pour votre pays et opérateur.

## 3. Premium
Page Premium : offrir une durée (jours, semaines, mois, années, à vie) à un compte, ou la retirer.

## 4. AdMob (publicité Google)
1. Créez l'application dans AdMob, puis un bloc « Bannière » et un bloc « Interstitiel ».
2. GitHub → Settings → Variables : `ADMOB_ANDROID_APP_ID` = identifiant de l'application (`ca-app-pub-…~…`). Sans elle, l'identifiant de test Google est utilisé.
3. Site admin → Réglages : activez « AdMob activé » et collez les deux identifiants de blocs.
4. Pour tester : identifiants de test Google (bannière `ca-app-pub-3940256099942544/9214589741`, plein écran `ca-app-pub-3940256099942544/1033173712`). Passez aux vrais identifiants avant la publication.
5. Mettez à jour la politique de confidentialité (AdMob collecte l'identifiant publicitaire). Les annonces sont demandées en mode non personnalisé.
