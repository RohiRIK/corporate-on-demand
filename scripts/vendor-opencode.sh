#!/bin/sh
# Fetch the pinned opencode binary.
#
# The 177 MB executable is deliberately NOT committed. A binary blob in git is
# permanent, unreviewable, and doubles the clone size of every fork; a pinned
# download is reproducible and auditable in one line.
#
# The version and its checksum are pinned here. A checksum is the point: without
# it, "vendored" just means "whatever the network served today".

set -eu

VERSION="1.18.31"
# The checksum of the linux-x64 build at v1.18.31, verified byte-identical to
# the binary that ran every test in the phase report. Pinned so the download is
# verifiable; without it "vendored" would just mean "whatever was served today".
EXPECTED="${COD_OPENCODE_SHA256:-f9dab32248695e9ebd56b16a1921798fd85112cf5a69c7dfd0cabc1e17be4a11}"
DEST="vendor/opencode/$VERSION/opencode"
URL="https://github.com/sst/opencode/releases/download/v$VERSION/opencode-linux-x64.tar.gz"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d "$(dirname "$DEST")" ]; then
  mkdir -p "$(dirname "$DEST")"
fi

if [ -f "$DEST" ]; then
  printf 'already vendored: %s\n' "$DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

printf 'downloading opencode %s...\n' "$VERSION"
curl -fsSL "$URL" -o "$TMP/opencode.tar.gz"

tar -xzf "$TMP/opencode.tar.gz" -C "$TMP"
if [ ! -f "$TMP/opencode" ]; then
  printf 'error: the archive did not contain an "opencode" binary\n' >&2
  exit 1
fi

if [ -n "$EXPECTED" ]; then
  ACTUAL="$(sha256sum "$TMP/opencode" | cut -d' ' -f1)"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    printf 'error: checksum mismatch\n  expected %s\n  actual   %s\n' "$EXPECTED" "$ACTUAL" >&2
    exit 1
  fi
  printf 'checksum verified: %s\n' "$ACTUAL"
else
  printf 'note: no COD_OPENCODE_SHA256 set, so this download is NOT verified.\n'
  printf '      actual sha256: %s\n' "$(sha256sum "$TMP/opencode" | cut -d' ' -f1)"
fi

mv "$TMP/opencode" "$DEST"
chmod 755 "$DEST"
printf 'vendored: %s\n' "$DEST"
