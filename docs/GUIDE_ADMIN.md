# Balade — Guide de l'administration

## 1. Créer le serveur Supabase (une seule fois)
1. Sur supabase.com, créez un compte puis un projet (nom : balade, région proche, mot de passe de base de données à noter).
2. Menu **SQL Editor** > **New query**. Ouvrez le fichier `supabase/setup_all.sql`, copiez tout son contenu, collez-le et touchez **Run**.
   - Lancez ce fichier UNE SEULE FOIS. En cas d'erreur, notez le message exact et envoyez-le moi.
3. Menu **Project Settings** > **API** : notez l'adresse du projet (`https://xxxx.supabase.co`) et la clé **anon public**.
   - La clé **service_role** est SECRÈTE : ne la copiez nulle part, ne la collez jamais dans l'admin ni dans une conversation.

## 2. Créer votre compte super administrateur
1. Menu **Authentication** > **Users** > **Add user** > **Create new user** : votre e-mail et un mot de passe solide. Cochez « Auto Confirm User ».
2. Menu **SQL Editor**, nouvelle requête (remplacez l'e-mail) :
   `update profiles set role = 'super_admin' where email = 'votre@email.com';`

## 3. Mettre le site en ligne (GitHub Pages)
1. Créez un dépôt GitHub **public** nommé `balade-admin` (il ne contient aucun secret).
2. Poussez-y ce projet. Dans le dépôt : **Settings** > **Pages** > **Source : GitHub Actions**.
3. Onglet **Actions** : le workflow « Deploy admin » publie le site. L'adresse apparaît dans Settings > Pages.
4. À la première ouverture, collez l'adresse du projet Supabase et la clé **anon** (enregistrées sur cet appareil seulement).

## 4. Les rôles
| Rôle | Peut faire |
|---|---|
| Super administrateur | Tout, y compris changer le rôle des comptes |
| Administrateur | Lieux, photos, catégories, annonces, réglages, soumissions, avis, signalements |
| Modérateur | Valider/refuser les lieux en attente, traiter signalements, masquer des avis |
| Créateur partenaire | Proposer des lieux (toujours « en attente » jusqu'à validation) |

Les droits sont appliqués par le serveur (règles RLS) : masquer un bouton ne suffit pas à contourner la sécurité.

## 5. Utilisation courante
- **Ajouter un lieu** : Lieux > Nouveau lieu. Collez les coordonnées copiées depuis Google Maps (appui long sur le lieu). Choisissez le type de prix ; une « estimation » est affichée comme telle dans l'app. Enregistrez, puis ajoutez les photos (cochez les droits).
- **Publier** : état « Publié » (position et catégorie obligatoires).
- **Annonces** : créez l'annonceur, puis l'annonce (titre, texte, image, lien, emplacement, dates), état « Active ». Notez le prix et la référence MoMo dans « Paiement ».
- **Réglages** : l'interrupteur « Publicité activée » coupe toute la pub d'un coup.

## 6. Limites connues
- Le niveau gratuit de Supabase a des limites (taille de base, stockage, mise en pause après inactivité) : à vérifier sur leur page de tarifs.
- L'app mobile ne lit pas encore ces données : c'est l'étape suivante.
- Le comptage des affichages est simple (pas de protection avancée contre les faux clics).

## 7. Statut en direct et rapports (migration 0003)
1. Supabase > SQL Editor > New query : collez le contenu de `supabase/migrations/0003_stats.sql` (seulement ce fichier, une seule fois) puis Run.
2. Dans l'administration : **Statut en direct** (serveur, appareils en ligne) et **Rapports** (7 jours, 30 jours, ce mois-ci, mois dernier, 90 jours, avec comparaison à la période précédente et export CSV).
3. Les chiffres viennent de l'app Balade (étape 9 ou plus). Ils sont anonymes : identifiant aléatoire, aucune position. L'utilisateur peut les désactiver dans Profil.

## 8. Thèmes
Thème clair par défaut. L'icône en haut à droite (soleil, lune, téléphone) change entre clair, sombre et automatique.

## 9. Comptes et avis (migration 0004)
1. SQL Editor : collez `supabase/migrations/0004_reviews.sql` (après 0001, 0002 et 0003), puis Run.
2. Supabase > Authentication > Sign In / Providers > **Email** : activé. Pour tester, désactivez « Confirm email » (sinon les nouveaux comptes doivent cliquer un lien reçu par e-mail, et l'envoi gratuit de Supabase est très limité).
3. Les avis signalés apparaissent dans « À traiter » et « Signalements » avec un bouton **Masquer l'avis**.

## 9. Comptes et avis (migration 0004)
1. Supabase > SQL Editor : exécutez `supabase/migrations_0003_0004.sql` si vous n'avez encore lancé ni 0003 ni 0004 (sinon seulement `0004_reviews.sql`).
2. Supabase > Authentication > Providers > Email : pour tester, désactivez « Confirm email » (les e-mails de confirmation intégrés sont très limités). Pour un vrai lancement, configurez un service d'envoi d'e-mails.
3. Dans l'administration, un avis abusif signalé apparaît dans « À traiter » ; « Masquer l'avis » le retire du public et corrige la note moyenne.
