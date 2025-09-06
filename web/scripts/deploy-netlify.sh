#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
npm run build
[ -f dist/_redirects ] || echo '/* /index.html 200' > dist/_redirects
cd dist && zip -qr ../dist.zip . && cd ..
echo "Built to ./dist and zipped to ./dist.zip"
