#!/usr/bin/env bash
#
# Packages the Kontent Voice Notes extension for Zen/Firefox and for Chrome.
#
# background/, content/, popup/ and icons/ are shared verbatim between the two
# browsers — only the manifest differs:
#
#   manifest.json          Chrome MV3   -> background.service_worker
#   manifest.firefox.json  Gecko MV3    -> background.scripts + gecko.id
#
# Usage:  ./build.sh [zen|chrome|all]     (default: all)
#
# Output: dist/kontent-voice-notes-zen.xpi
#         dist/kontent-voice-notes-chrome.zip
#         plus the unpacked dist/zen/ and dist/chrome/ staging folders, which
#         are what you point "Load Temporary Add-on" / "Load unpacked" at.

set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:-all}"
SHARED=(background content popup icons)

# Zip from *inside* the staging dir so manifest.json sits at the archive root —
# both stores reject an archive whose manifest is nested in a folder.
pack() {
  local stage="$1" out="$2"
  rm -f "$out"
  if command -v zip >/dev/null; then
    ( cd "$stage" && zip -qr -FS "$OLDPWD/$out" . -x '.*' )
  else
    # No zip binary (common on minimal Arch installs) — python3 can do it.
    python3 - "$stage" "$out" <<'PY'
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(stage):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in sorted(files):
            if f.startswith('.'):
                continue
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, stage))
PY
  fi
}

build() {
  local name="$1" manifest="$2" out="$3"
  local stage="dist/$name"

  rm -rf "$stage"
  mkdir -p "$stage"
  cp -r "${SHARED[@]}" "$stage/"
  cp "$manifest" "$stage/manifest.json"

  pack "$stage" "$out"
  echo "  $out   (unpacked: $stage/)"
}

mkdir -p dist
echo "Building:"

case "$TARGET" in
  zen|firefox) build zen    manifest.firefox.json dist/kontent-voice-notes-zen.xpi ;;
  chrome)      build chrome manifest.json         dist/kontent-voice-notes-chrome.zip ;;
  all)
    build zen    manifest.firefox.json dist/kontent-voice-notes-zen.xpi
    build chrome manifest.json         dist/kontent-voice-notes-chrome.zip
    ;;
  *) echo "usage: $0 [zen|chrome|all]" >&2; exit 1 ;;
esac

cat <<'EOF'

Install:
  Zen / Firefox   about:debugging#/runtime/this-firefox -> Load Temporary Add-on…
                  -> dist/zen/manifest.json   (temporary; see README-install.md
                     for a signed, permanent install)
  Chrome          chrome://extensions -> Developer mode -> Load unpacked
                  -> dist/chrome/
EOF
