#!/bin/bash
# The W1 spike on WebKitGTK, in desktop/linux.Dockerfile's image (which has Rust, WebKitGTK, Bun
# and Xvfb), from the repository's root on a Mac:
#
#   docker build -f desktop/linux.Dockerfile -t seismic-linux-app desktop
#   docker run --rm -v "$PWD":/src:ro -v seismic-cargo:/root/.cargo/registry -v seismic-spike-target:/work/desktop/spike/target \
#     -v "$PWD/dist/spike":/out seismic-linux-app bash /src/desktop/spike/linux.sh
set -euo pipefail
mkdir -p /work/desktop
rsync -a --delete --exclude /target /src/desktop/spike/ /work/desktop/spike/
cp -r /src/desktop/icons /work/desktop/
cd /work/desktop/spike
cargo build
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 &
eval "$(dbus-launch --sh-syntax)"
sleep 1
status=0
bun run.ts target/debug/webview-spike || status=1
[ -d /out ] && cp target/spike-linux.json /out/
exit $status
