# Premium, PawaPay et régie publicitaire

## 1. Base de données (SQL Editor Supabase)
1. Lancez `supabase/migrations/0008_premium_profil.sql`.
2. Prix des offres : table `premium_plans` (Table Editor) : `price`, `days`, `active`.

## 2. Paiement MTN Mobile Money (API Collection)
Fonctions à créer dans Supabase → Edge Functions (collez les fichiers de `supabase/functions/`) : `momo-checkout` et `momo-status`. Laissez « Verify JWT » activé pour les deux.
Secrets (Edge Functions → Secrets) :
- `MOMO_SUBSCRIPTION_KEY` : clé d'abonnement (profil du portail MTN, « Primary key »)
- `MOMO_API_USER` : identifiant de l'utilisateur d'API
- `MOMO_API_KEY` : clé d'API
- Bac à sable : `MOMO_BASE` = `https://sandbox.momodeveloper.mtn.com`, `MOMO_ENV` = `sandbox` (devise EUR automatique).
- Production (après le Go-Live accepté par MTN) : `MOMO_BASE` = `https://proxy.momoapi.mtn.com`, `MOMO_ENV` = `mtncongo`, `MOMO_CURRENCY` = `XAF` (valeurs données par la communauté officielle MTN MoMo). La clé d'abonnement de production est différente : elle se trouve dans le profil de `momoapi.mtn.com`, et l'utilisateur et la clé d'API se créent dans le portail partenaire que MTN vous ouvre après validation du dossier.
- Production, format du numéro : le préfixe `242` est ajouté automatiquement. Si MTN refuse les numéros avec le 0 initial, ajoutez `MOMO_STRIP_ZERO` = `1`.
Les fonctions `pawapay-*` ne sont plus utilisées par l'application.

## 3. Premium
Page Premium : offrir une durée (jours, semaines, mois, années, à vie) à un compte, ou la retirer.

## 4. AdMob (publicité Google)
1. Créez l'application dans AdMob, puis un bloc « Bannière » et un bloc « Interstitiel ».
2. GitHub → Settings → Variables : `ADMOB_ANDROID_APP_ID` = identifiant de l'application (`ca-app-pub-…~…`). Sans elle, l'identifiant de test Google est utilisé.
3. Site admin → Réglages : activez « AdMob activé » et collez les deux identifiants de blocs.
4. Pour tester : identifiants de test Google (bannière `ca-app-pub-3940256099942544/9214589741`, plein écran `ca-app-pub-3940256099942544/1033173712`). Passez aux vrais identifiants avant la publication.
5. Mettez à jour la politique de confidentialité (AdMob collecte l'identifiant publicitaire). Les annonces sont demandées en mode non personnalisé.
