#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
npm run build
cd dist && zip -qr ../dist.zip . && cd ..
echo "Built to ./dist and zipped to ./dist.zip"
