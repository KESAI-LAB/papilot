#!/usr/bin/env bash
set -euo pipefail

publisher="$PWD/scripts/publish-aur.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init --bare -q --initial-branch=master "$work/remote"
cp -R packaging/aur "$work/recipe"
version() {
  local name=$1
  sed -i "s/^pkgver=.*/pkgver=$name/" "$work/recipe/PKGBUILD"
  sed -i "s/pkgver = .*/pkgver = $name/" "$work/recipe/.SRCINFO"
}
sha() { git -C "$work/remote" rev-parse master; }
publish() { bash "$publisher" "$work/remote" "$work/recipe"; }
version 0.1.0
publish
initial=$(sha)
publish
test "$(sha)" = "$initial"
version 0.0.9
publish
test "$(sha)" = "$initial"

version 0.1.1
printf '#!/bin/sh\nexit 1\n' > "$work/remote/hooks/pre-receive"
chmod +x "$work/remote/hooks/pre-receive"
if publish; then exit 1; fi
test "$(sha)" = "$initial"
rm "$work/remote/hooks/pre-receive"
publish
test "$(sha)" != "$initial"
echo 'AUR initial push, duplicate and old versions, rejected push and retry passed.'
