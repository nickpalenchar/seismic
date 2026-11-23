#!/bin/bash
# Run the HTTPS cookie spike on a disposable GitHub runner or in the Linux test container.
# Both the shell and the native webview use the runner's trust store.
set -euo pipefail
if [ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ]; then
  platform=${RUNNER_OS:?Missing GitHub runner OS}
  trust=(sudo)
elif [ "$(uname -s)" = Linux ] && [ -f /.dockerenv ] && [ "$(id -u)" = 0 ]; then
  platform=Linux
  trust=()
else
  echo "Use a disposable GitHub-hosted runner or the Linux spike Docker container." >&2
  exit 1
fi

# a trust store change that waits for a confirmation nobody can give fails after a minute instead
bounded() { echo "+ $*" >&2; perl -e 'alarm shift; exec @ARGV or die "$ARGV[0]: $!"' 60 "$@"; }

certs=$(mktemp -d)
anchor="/usr/local/share/ca-certificates/seismic-spike-${certs##*/}.crt"
fingerprint=
cleanup() {
  case "$platform" in
    Linux)
      if [ -e "$anchor" ]; then
        "${trust[@]}" rm -f "$anchor"
        "${trust[@]}" update-ca-certificates --fresh >/dev/null
      fi
      ;;
    macOS)
      if [ -n "$fingerprint" ]; then
        bounded sudo security remove-trusted-cert -d "$certs/ca.crt" || true
        bounded sudo security delete-certificate -Z "$fingerprint" /Library/Keychains/System.keychain
      fi
      ;;
    Windows)
      if [ -n "$fingerprint" ]; then bounded certutil.exe -delstore Root "$fingerprint"; fi
      ;;
  esac
  rm -rf "$certs"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cat >"$certs/openssl.cnf" <<'EOF'
[ req ]
prompt = no
distinguished_name = request_name
[ request_name ]
CN = $ENV::SPIKE_CERT_CN
[ ca_extensions ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign
EOF
SPIKE_CERT_CN='Seismic spike test CA' openssl req -config "$certs/openssl.cnf" \
  -x509 -newkey rsa:2048 -nodes -sha256 -days 1 -extensions ca_extensions \
  -keyout "$certs/ca.key" -out "$certs/ca.crt" 2>"$certs/openssl.log" || { cat "$certs/openssl.log"; exit 1; }
SPIKE_CERT_CN=127.0.0.1 openssl req -config "$certs/openssl.cnf" -new -newkey rsa:2048 -nodes -sha256 \
  -keyout "$certs/loopback.key" -out "$certs/loopback.csr" 2>"$certs/openssl.log" || { cat "$certs/openssl.log"; exit 1; }
cat >"$certs/loopback.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
subjectAltName=IP:127.0.0.1
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -sha256 -days 1 -in "$certs/loopback.csr" -CA "$certs/ca.crt" \
  -CAkey "$certs/ca.key" -CAcreateserial -extfile "$certs/loopback.ext" -out "$certs/loopback.crt"

case "$platform" in
  Linux)
    "${trust[@]}" install -m 0644 "$certs/ca.crt" "$anchor"
    "${trust[@]}" update-ca-certificates
    ;;
  macOS)
    fingerprint=$(openssl x509 -in "$certs/ca.crt" -noout -sha1 -fingerprint | cut -d= -f2 | tr -d :)
    bounded sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$certs/ca.crt"
    ;;
  Windows)
    fingerprint=$(openssl x509 -in "$certs/ca.crt" -noout -sha1 -fingerprint | cut -d= -f2 | tr -d ':\r')
    # the machine store: the user's Root store asks for a confirmation in a dialog
    bounded certutil.exe -f -addstore Root "$(cygpath -w "$certs/ca.crt")"
    certs_for_bun=$(cygpath -w "$certs")
    ;;
  *) echo "Unrecognised runner: $platform" >&2; exit 1 ;;
esac
certs_for_bun=${certs_for_bun:-$certs}
SPIKE_TLS_CA="$certs_for_bun/ca.crt" SPIKE_TLS_CERT="$certs_for_bun/loopback.crt" SPIKE_TLS_KEY="$certs_for_bun/loopback.key" \
  bun "$(dirname "$0")/run.ts" "$@"
