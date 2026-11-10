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
