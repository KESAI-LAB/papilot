#!/usr/bin/env bash
set -euo pipefail

current=$(realpath "$1")
version=$(dpkg-deb -f "$current" Version)
test "$(dpkg-deb -f "$current" Architecture)" = amd64
dpkg-deb -f "$current" Provides | grep -x 'papilot'
work=$(mktemp -d /tmp/papilot-apt.XXXXXXXX)
app=''
cleanup() {
  if [[ -n $app ]]; then kill -- "-$app" 2>/dev/null || true; wait "$app" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
chmod 755 "$work"
mkdir -p "$work/repo/pool" "$work/repo/dists/papilot/main/binary-amd64"
mkdir -m 700 "$work/gpg" "$work/data"
repo="$work/repo"
previous="$repo/pool/Papilot-0.11.0-linux-amd64.deb"
curl -fsSL --retry 3 https://github.com/PapilotAI/papilot/releases/download/v0.11.0/Papilot-0.11.0-linux-amd64.deb -o "$previous"
printf '%s  %s\n' '4b9d1b1b76c563be4b4d5e64eef306a0b771f28d26dc4ef745080096bd3eab6d' "$previous" | sha256sum -c
cp "$current" "$repo/pool/"
(
  cd "$repo"
  index='main/binary-amd64/Packages'
  dpkg-scanpackages --multiversion pool /dev/null > "dists/papilot/$index"
  cd dists/papilot
  {
    printf 'Origin: Papilot test\nLabel: Papilot test\nSuite: papilot\nCodename: papilot\nArchitectures: amd64\nComponents: main\n'
    printf 'Date: %s\n' "$(LC_ALL=C date -Ru)"
    printf 'SHA256:\n %s %s %s\n' "$(sha256sum "$index" | cut -d' ' -f1)" "$(stat -c '%s' "$index")" "$index"
  } > Release
  gpg --homedir "$work/gpg" --batch --pinentry-mode loopback --passphrase '' \
    --quick-generate-key 'Papilot packaging fixture' rsa2048 sign 1d
  gpg --homedir "$work/gpg" --batch --pinentry-mode loopback --passphrase '' --clearsign -o InRelease Release
  gpg --homedir "$work/gpg" --batch --export > "$work/papilot.gpg"
)
{
  if [[ -f /etc/apt/sources.list ]]; then cat /etc/apt/sources.list; fi
  printf '\ndeb [arch=amd64 signed-by=%s] file:%s papilot main\n' "$work/papilot.gpg" "$repo"
} > "$work/sources.list"
apt_source=(-o "Dir::Etc::sourcelist=$work/sources.list")
sudo apt-get "${apt_source[@]}" -o APT::Update::Error-Mode=any update
sudo apt-get "${apt_source[@]}" install -y papilot-desktop=0.11.0

launch() {
  rm -f "$work/data/desktop-port.json"
  PAPILOT_DESKTOP_DATA="$work/data" setsid /opt/Papilot/papilot > "$work/papilot.log" 2>&1 &
  app=$!
  for attempt in {1..120}; do
    if port=$(cat "$work/data/desktop-port.json" 2>/dev/null) &&
       curl -fsS --max-time 2 "http://127.0.0.1:$port/api/state" > "$work/state.json"; then
      origin="http://127.0.0.1:$port"
      return
    fi
    kill -0 "$app" 2>/dev/null || break
    sleep 1
  done
  cat "$work/papilot.log"
  return 1
}
launch
project=$(jq -er '.projects[0].id' "$work/state.json")
csrf=$(jq -er '.csrf' "$work/state.json")
curl -fsS -H "Origin: $origin" -H "X-Papilot-Token: $csrf" -H 'Content-Type: application/json' \
  --data '{"quickNotes":[{"id":"apt-smoke","label":"Check the source","instruction":"Check the source."}]}' \
  "$origin/api/quick-notes" | jq -e '.quickNotes[0].id == "apt-smoke"' > /dev/null
kill -- "-$app"
wait "$app" || true
app=''
sudo apt-get "${apt_source[@]}" install -y papilot
test "$(dpkg-query -W -f '${Version}' papilot-desktop)" = "$version"
test -f /opt/Papilot/resources/package-managed
launch
jq -e --arg project "$project" '.projects | any(.id == $project)' "$work/state.json" > /dev/null
curl -fsS "$origin/api/quick-notes" | jq -e '.quickNotes[0].id == "apt-smoke"' > /dev/null
curl -fsS "$origin/api/updates" | jq -e '.packageManager == "managed" and .canUpdate == false' > /dev/null
echo "Signed APT install and upgrade preserved the project and its quick note setting."
