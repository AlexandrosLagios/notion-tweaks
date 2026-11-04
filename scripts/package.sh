#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
archive="dist/inbox-tweaks-for-notion-$version.zip"
mkdir -p dist
rm -f "$archive"
zip -qr "$archive" manifest.json sidepanel.html options.html src icons
echo "$archive"
