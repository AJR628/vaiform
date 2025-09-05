#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
npm run build
if [ ! -f dist/_redirects ]; then
  echo '/* /index.html 200' > dist/_redirects
fi
cd dist
zip -qr ../dist.zip .
cd ..
echo "Built to ./dist and zipped to ./dist.zip"
echo
echo "👉 Netlify deploy:"
echo "   - Drag & drop the contents of ./dist into Netlify (or upload dist.zip)."
echo
echo "Detected API base:"
node -e 'console.log(process.env.VITE_API_BASE || "VITE_API_BASE not set at build")'


