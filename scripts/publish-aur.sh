#!/usr/bin/env bash
set -euo pipefail

remote=$1
recipe=$2
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT
version() { awk '$1 == "pkgver" && $2 == "=" { print $3; exit }' "$1"; }
next=$(version "$recipe/.SRCINFO")
[[ $next =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid AUR recipe version.' >&2; exit 1; }
git clone "$remote" "$workspace/aur"
cd "$workspace/aur"
if git show-ref --verify --quiet refs/remotes/origin/master; then
  git checkout -B master origin/master
  previous=$(version .SRCINFO)
  [[ $previous =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid published AUR version.' >&2; exit 1; }
  if (( $(vercmp "$next" "$previous") <= 0 )); then
    printf 'AUR already has %s. Requested %s was skipped.\n' "$previous" "$next"
    exit 0
  fi
else
  git symbolic-ref HEAD refs/heads/master
fi
cp "$recipe"/{PKGBUILD,.SRCINFO,papilot,LICENSE} .
git add -- PKGBUILD .SRCINFO papilot LICENSE
git -c user.name='Papilot release' -c user.email='release@papilot.ai' commit -m "Update papilot-bin to $next"
git push origin HEAD:refs/heads/master
printf 'Published papilot-bin %s.\n' "$next"
