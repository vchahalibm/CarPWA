#!/bin/bash
# The StudioGen signing certificate for a build (.github/workflows/desktop.yml): MAC_CERT_P12 (base64 of a .p12) and
# MAC_CERT_PASSWORD → a temporary keychain; prints MAC_SIGN_ID=… and MAC_SIGN_KEYCHAIN=… lines for $GITHUB_ENV.
# - macOS reads only the older .p12 encryption, and OpenSSL 3+ makes the newer one by default: the file is re-packed first.
# - The identity is a certificate WITH its private key; a .p12 without the key can't sign.
# - Anything wrong: a warning, and no lines (the build signs ad-hoc: it still works, the Keychain asks after updates).
# Usage: tools/release/import-cert.sh <keychain path>
set -u
KC="$1"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
warn() { echo "::warning::Signing certificate: $1. This build is signed ad-hoc." >&2; exit 0; }
[ -n "${MAC_CERT_P12:-}" ] || { echo "No MAC_CERT_P12 secret: the apps are signed ad-hoc" >&2; exit 0; }
OSSL=openssl; for o in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do [ -x "$o" ] && { OSSL="$o"; break; }; done
printf '%s' "$MAC_CERT_P12" | base64 --decode > "$T/in.p12" 2>/dev/null || warn "MAC_CERT_P12 isn't base64"
# read it (as it is, or as an old-style file), then write it the way macOS reads
if ! "$OSSL" pkcs12 -in "$T/in.p12" -passin env:MAC_CERT_PASSWORD -nodes -out "$T/all.pem" 2>/dev/null && ! "$OSSL" pkcs12 -legacy -in "$T/in.p12" -passin env:MAC_CERT_PASSWORD -nodes -out "$T/all.pem" 2>/dev/null; then
  warn "the .p12 can't be opened with MAC_CERT_PASSWORD (wrong password, or not a .p12)"
fi
grep -q "PRIVATE KEY" "$T/all.pem" || warn "the .p12 holds no private key (export the certificate together with its key: Keychain Access › My Certificates › the certificate › Export… › .p12)"
grep -q "BEGIN CERTIFICATE" "$T/all.pem" || warn "the .p12 holds no certificate"
"$OSSL" pkcs12 -export -legacy -in "$T/all.pem" -passout env:MAC_CERT_PASSWORD -out "$T/cs.p12" 2>/dev/null \
  || "$OSSL" pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -in "$T/all.pem" -passout env:MAC_CERT_PASSWORD -out "$T/cs.p12" 2>/dev/null \
  || warn "the certificate couldn't be re-packed"
KP="$(openssl rand -hex 16)"
security create-keychain -p "$KP" "$KC" && security set-keychain-settings -lut 21600 "$KC" && security unlock-keychain -p "$KP" "$KC" || warn "no keychain"
security import "$T/cs.p12" -k "$KC" -P "$MAC_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null 2>"$T/err" || warn "macOS didn't import it ($(head -1 "$T/err"))"
security set-key-partition-list -S apple-tool:,apple: -s -k "$KP" "$KC" >/dev/null 2>&1
[ -n "${GITHUB_ACTIONS:-}" ] && security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"') # on the build machine only: codesign finds it by name too
ID="$(security find-identity -p codesigning "$KC" | awk '/[0-9A-F]{40}/{print $2; exit}')" # a certificate with its key, whatever its name
[ -n "$ID" ] || warn "no certificate with its private key in it"
echo "MAC_SIGN_ID=$ID"; echo "MAC_SIGN_KEYCHAIN=$KC"
