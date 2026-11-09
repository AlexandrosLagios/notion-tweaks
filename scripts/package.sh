#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
archive="dist/enhanced-notion-$version.zip"
npm run --silent build
mkdir -p dist
rm -f "$archive"
zip -qr "$archive" manifest.json sidepanel.html src/*.js icons
echo "$archive"
