# Balade · Administration (site web privé)

Mise en route sur téléphone (Debian), Node 22 requis :

```
cd ~
npm create vite@latest balade-admin -- --template react-ts
cd balade-admin
npm install
cp /sdcard/Download/balade-admin-v5.zip .
unzip -o balade-admin-v5.zip
sh apply-admin.sh
```
Puis suivez `docs/GUIDE_ADMIN.md` (Supabase, compte super administrateur, GitHub Pages).
