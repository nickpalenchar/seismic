#!/bin/bash
# What desktop/linux.Dockerfile's container runs: build, install, check.
set -euo pipefail
rsync -a --delete --exclude node_modules --exclude /desktop/target --exclude /dist --exclude /desktop/binaries --exclude /desktop/staged /src/ /work/
cd /work
bun install --frozen-lockfile
# linuxdeploy is an AppImage itself, and a container has no FUSE
export APPIMAGE_EXTRACT_AND_RUN=1
bun scripts/build-app.ts
bundle=desktop/target/release/bundle
cp "$bundle"/appimage/*.AppImage "$bundle"/deb/*.deb /out/
ls -la /out

# a display, a session bus and a microphone (a source that plays a tone), as a desktop has them
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 &
eval "$(dbus-launch --sh-syntax)"
pulseaudio --start --exit-idle-time=-1
# a sink's monitor will not do: WebKitGTK lists no monitors among the microphones
pactl load-module module-sine-source source_name=mic frequency=440 >/dev/null
pactl set-default-source mic
sleep 1

apt-get install -y "$(ls /out/*.deb)" >/dev/null 2>&1 || dpkg -i /out/*.deb
status=0
echo "== the .deb (/usr/bin/seismic)"
bun scripts/check-app.ts /usr/bin/seismic --screenshot /out/linux-deb.png || status=1
echo "== the AppImage"
chmod +x /out/*.AppImage
bun scripts/check-app.ts "$(ls /out/*.AppImage)" --screenshot /out/linux-appimage.png || status=1
echo "== the workspaces in the .deb"
bun scripts/check-app-desks.ts /usr/bin/seismic 2>&1 | tee /out/linux-desks.txt || status=1
exit $status
