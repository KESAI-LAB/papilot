#!/usr/bin/env bash
set -euo pipefail

recipe=$1
output=$2
publish=${3:-false}
[[ $EUID -eq 0 ]] || { echo 'Run this check in a disposable Arch environment as root.' >&2; exit 1; }
id papilot-builder >/dev/null 2>&1 || useradd -m papilot-builder
work=$(mktemp -d /tmp/papilot-aur.XXXXXXXX)
trap 'pkill -TERM -u papilot-builder 2>/dev/null || true; rm -rf "$work"' EXIT
as_builder() { runuser -u papilot-builder -- "$@"; }
build_package() {
  local source=$1 build=$2
  mkdir "$build"
  cp "$source"/{PKGBUILD,papilot,LICENSE} "$build/"
  chown papilot-builder:papilot-builder "$work" "$build" "$build"/*
  (
    cd "$build"
    as_builder makepkg --printsrcinfo > .SRCINFO
    if [[ -f "$source/.SRCINFO" ]]; then diff -u "$source/.SRCINFO" .SRCINFO; fi
    mapfile -t deps < <(awk '$1 == "depends" && $2 == "=" { print $3 }' .SRCINFO)
    pacman -S --noconfirm --needed "${deps[@]}"
    as_builder makepkg --verifysource --noconfirm
    as_builder env PKGEXT=.pkg.tar makepkg --noconfirm
  )
}
build_package "$recipe" "$work/current"
package=("$work"/current/papilot-bin-*.pkg.tar)
data="$work/test-data"
as_builder mkdir "$data"
previous=${4:-}
if [[ -n "$previous" ]]; then
  build_package "$previous" "$work/previous"
  old=("$work"/previous/papilot-bin-*.pkg.tar)
  pacman -U --noconfirm "${old[0]}"
  as_builder env PAPILOT_DESKTOP_DATA="$data" xvfb-run -a bash -se <<'PREVIOUS'
set -o pipefail
setsid /usr/bin/papilot > "$PAPILOT_DESKTOP_DATA/previous.log" 2>&1 &
app=$!
trap 'kill -- "-$app" 2>/dev/null || true; wait "$app" 2>/dev/null || true' EXIT
for attempt in {1..120}; do
  if port=$(cat "$PAPILOT_DESKTOP_DATA/desktop-port.json" 2>/dev/null) &&
     curl -fsS --max-time 2 "http://127.0.0.1:$port/api/state" |
       jq -er '.projects[0].id' > "$PAPILOT_DESKTOP_DATA/expected-project"; then
    origin="http://127.0.0.1:$port"
    csrf=$(curl -fsS "$origin/api/state" | jq -er .csrf)
    curl -fsS -H "Origin: $origin" -H "X-Papilot-Token: $csrf" -H 'Content-Type: application/json' \
      --data '{"quickNotes":[{"id":"aur-smoke","label":"Keep this setting","instruction":"Check the sources."}]}' \
      "$origin/api/quick-notes" | jq -e '.quickNotes[0].id == "aur-smoke"' > /dev/null
    exit 0
  fi
  sleep 1
done
cat "$PAPILOT_DESKTOP_DATA/previous.log"
exit 1
PREVIOUS
fi
pacman -U --noconfirm "${package[0]}"
test "$(stat -c '%u:%a' /opt/Papilot/chrome-sandbox)" = '0:4755'
/opt/Papilot/resources/runtime/bin/node --version
ldd /opt/Papilot/papilot | tee elf-dependencies.log
if grep -q 'not found' elf-dependencies.log; then exit 1; fi
desktop-file-validate /usr/share/applications/ai.papilot.desktop.desktop
grep -Fx 'MimeType=x-scheme-handler/papilot;' /usr/share/applications/ai.papilot.desktop.desktop
if [[ $publish == true ]]; then
  # Native update ownership is supported by installers built with this flag.
  LC_ALL=C grep -aq 'PAPILOT_DESKTOP_PACKAGE_UPDATES' /opt/Papilot/resources/app.asar
fi

mkdir -p "$output"
cp "$work/current"/{PKGBUILD,.SRCINFO,papilot,LICENSE} "$output/"
version=$(awk '$1 == "pkgver" && $2 == "=" { print $3; exit }' "$work/current/.SRCINFO")
as_builder env PAPILOT_DESKTOP_DATA="$data" PAPILOT_AUR_EXPECT_MANAGED="$publish" PAPILOT_AUR_VERSION="$version" xvfb-run -a bash -se <<'SMOKE'
set -o pipefail
data=$PAPILOT_DESKTOP_DATA
check() {
  local port
  port=$(cat "$data/desktop-port.json" 2>/dev/null) || return 1
  curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" |
    jq -e --arg version "$PAPILOT_AUR_VERSION" '.name == "Papilot" and .version == $version' > /dev/null
}
wait_for_app() {
  for attempt in {1..120}; do
    if check && xdotool search --onlyvisible --name Papilot > /dev/null; then
      port=$(cat "$data/desktop-port.json")
      if [[ -s "$data/expected-project" ]]; then
        expected=$(cat "$data/expected-project")
        curl -fsS "http://127.0.0.1:$port/api/state" | jq -e --arg expected "$expected" '.projects | any(.id == $expected)' > /dev/null
        curl -fsS "http://127.0.0.1:$port/api/quick-notes" | jq -e '.quickNotes[0].id == "aur-smoke"' > /dev/null
      fi
      if [[ $PAPILOT_AUR_EXPECT_MANAGED == true ]]; then
        curl -fsS "http://127.0.0.1:$(cat "$data/desktop-port.json")/api/updates" |
          grep -q '"packageManager":"managed"'
      fi
      return 0
    fi
    sleep 1
  done
  cat "$data/launch.log"
  return 1
}
setsid /usr/bin/papilot > "$data/launch.log" 2>&1 &
app=$!
wait_for_app
kill -- "-$app"
wait "$app" || true
rm "$data/desktop-port.json"
gio launch /usr/share/applications/ai.papilot.desktop.desktop > "$data/launch.log" 2>&1
wait_for_app
scrot "$data/aur-desktop.png"
SMOKE
cp "$data/aur-desktop.png" "$output/"
pkill -TERM -u papilot-builder || true
pacman -R --noconfirm papilot-bin
test -s "$data/papilot.sqlite"
