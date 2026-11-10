#!/bin/sh
# À lancer dans le projet Vite fraîchement créé, après `unzip -o balade-admin.zip`.
set -e
npm install @supabase/supabase-js
# Adresse relative pour GitHub Pages : on ajoute base: './' à la configuration Vite du modèle (sans la remplacer).
for f in vite.config.ts vite.config.js; do
  [ -f "$f" ] && node -e "const fs=require('fs');const f='$f';let t=fs.readFileSync(f,'utf8');if(!/base\s*:/.test(t)){t=t.replace('defineConfig({','defineConfig({ base: \'./\',');fs.writeFileSync(f,t);}"
done
rm -f src/App.css src/index.css
rm -rf src/assets
npm pkg set scripts.test="node --test src/lib/*.test.ts"
# Les fichiers de test utilisent node:test : on les exclut de la compilation du site.
for f in tsconfig.app.json; do
  [ -f "$f" ] && node -e "const fs=require('fs');const f='$f';const t=fs.readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,'');const j=JSON.parse(t);j.exclude=[...(j.exclude||[]),'src/**/*.test.ts'];fs.writeFileSync(f,JSON.stringify(j,null,2))"
done
npx tsc -b
npm test
echo "OK : administration prête. Poussez sur GitHub (dépôt PUBLIC, sans secret) puis activez Pages."
