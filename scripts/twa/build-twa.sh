#!/usr/bin/env bash
# Package the PWA as an Android App Bundle (.aab) for Google Play using a
# Trusted Web Activity (#79). Runs Google's Bubblewrap CLI.
#
#   SITE=https://speconeautolabs.co.uk npm run twa
#
# First run asks a few questions (app name, colours, signing key). Afterwards:
#   1. Copy the SHA-256 fingerprint it prints into the Worker secret
#      TWA_SHA256_FINGERPRINTS and set TWA_PACKAGE_NAME (see docs/DEPLOY.md),
#      so /.well-known/assetlinks.json verifies the app and it opens full-screen.
#   2. Upload scripts/twa/out/app-release-bundle.aab in the Play Console.
set -euo pipefail
SITE="${SITE:-https://speconeautolabs.co.uk}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"
mkdir -p "$OUT"
cd "$OUT"
if ! command -v java >/dev/null 2>&1; then
  echo "Java 17+ is required (Bubblewrap can install a JDK for you on first run)." >&2
fi
if [ ! -f twa-manifest.json ]; then
  npx --yes @bubblewrap/cli@1.27.0 init --manifest="$SITE/manifest.webmanifest" --directory="$OUT"
fi
npx --yes @bubblewrap/cli@1.27.0 build
echo
echo "Built: $OUT/app-release-bundle.aab"
echo "Signing key fingerprint (add to TWA_SHA256_FINGERPRINTS):"
npx --yes @bubblewrap/cli@1.27.0 fingerprint list || true
