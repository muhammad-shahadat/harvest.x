#!/usr/bin/env bash
# Builds the website and copies it to the repo root, because GitHub Pages is set to "Deploy from a branch: main / (root)".
# Run this after you change anything in client/, then commit and push:   bash scripts/publish-pages.sh
# The two Supabase values are PUBLIC (they are shipped to every browser), so it is fine that they are written here.
# Another project? Override them:  VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... bash scripts/publish-pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://rpjvqpkyhdnadkysvqpu.supabase.co}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_NgfD-GTpON7fAVUpjGr5Vg_tmkbFRBB}"
(cd client && npm ci --silent && VITE_BASE=/harvest.x/ npm run build)
rm -rf assets index.html 404.html
cp -r client/dist/assets ./assets
cp client/dist/index.html ./index.html
cp client/dist/index.html ./404.html   # Pages shows 404.html for unknown addresses, so /login etc. still open the app
touch .nojekyll                         # serve the files as they are (no Jekyll)
echo "Done. Now: git add -A && git commit -m 'Update site' && git push"
