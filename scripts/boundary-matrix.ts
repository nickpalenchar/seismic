// Runs the Linux scope prototype's tests and probe (scripts/linux-scope-prototype.test.ts,
// scripts/linux-scope-probe.ts) in a Docker container that boots systemd, in each of
// the situations a user manager can be in, and prints one JSON line per run. Needs Docker that can run
// a privileged container with cgroup v2 (Docker Desktop does); nothing is left running afterwards.
//   bun scripts/boundary-matrix.ts [--codex]
// Image: Debian 13 (systemd 257) on the Bun image; native Ubuntu runners with older systemd are
// .github/workflows/process-boundary.yml's.
// Situations: `bus` (manager and D-Bus), `no-dbus` (manager without a bus daemon: dbus stopped, its
// socket gone), `ro-cgroup` (a mount namespace in which /sys/fs/cgroup is read-only, the manager
// unchanged), `no-manager` (a user without lingering, so no user manager runs), and `unprivileged` (an
// ordinary container: no systemd, read-only cgroupfs). `--codex` also installs the Codex CLI of the
// version SEISMIC_MATRIX_CODEX names (0.162.0 by default) and runs the probe's real Codex cases.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const BUN = 'oven/bun:1.3.14';
const IMAGES: Record<string, string> = { trixie: BUN };
const codex = process.argv.includes('--codex');
const images = Object.keys(IMAGES);
const CODEX_VERSION = (process.env.SEISMIC_MATRIX_CODEX ?? process.env.OBEYA_MATRIX_CODEX) ?? '0.162.0';

function sh(argv: string[], input?: string) {
  const r = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function dockerfile(base: string) {
  return [
    `FROM ${base}`,
    'RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session libpam-systemd python3 util-linux ca-certificates && rm -rf /var/lib/apt/lists/*',
    // `worker` lingers, so its user manager starts at boot; `nolinger` has none
    'RUN useradd -m -u 1500 worker && useradd -m -u 1501 nolinger && mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/worker',
    'STOPSIGNAL SIGRTMIN+3',
    'CMD ["/sbin/init"]',
  ].filter(Boolean).join('\n');
}

const report = (image: string, situation: string, step: string, result: unknown) => console.log(JSON.stringify({ image, situation, step, ...((typeof result === 'object' && result) || { result }) }));

/** The test file's verdicts, without the noise around them. */
function tests(out: string) {
  return { tests: out.split('\n').filter((l) => /^\((pass|fail|skip)\)/.test(l)).map((l) => l.replace(/ \[[\d.]+m?s\]$/, '')), summary: out.split('\n').filter((l) => /^\s*\d+ (pass|fail|skip)$/.test(l)).map((l) => l.trim()) };
}
function probe(out: string) {
  return out.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

const asWorker = (name: string, env: string[], command: string) => ['docker', 'exec', '-u', 'worker', '-w', '/w', ...env.flatMap((e) => ['-e', e]), name, 'sh', '-c', command];
const RUNTIME = 'XDG_RUNTIME_DIR=/run/user/1500';
const TEST = 'bun test scripts/linux-scope-prototype.test.ts 2>&1';

for (const image of images) {
  const base = IMAGES[image];
  if (!base) throw new Error(`unknown image ${image}`);
  const tag = `obeya-boundary-${image}`;
  const built = sh(['docker', 'build', '-q', '-t', tag, '-'], dockerfile(base));
  if (built.code !== 0) { report(image, '-', 'build', { status: 'blocked', why: built.out.slice(-800) }); continue; }
  const name = `obeya-boundary-${image}-${process.pid}`;
  try {
    const run = sh(['docker', 'run', '-d', '--name', name, '--privileged', '--cgroupns=private', '--tmpfs', '/run', '--tmpfs', '/run/lock', '-v', `${ROOT}:/w:ro`, tag]);
    if (run.code !== 0) { report(image, '-', 'boot', { status: 'blocked', why: run.out.slice(-800) }); continue; }
    const deadline = Date.now() + 60_000;
    while (sh(['docker', 'exec', name, 'test', '-S', '/run/user/1500/bus']).code !== 0 && Date.now() < deadline) await Bun.sleep(500);
    const versions = sh(['docker', 'exec', name, 'sh', '-c', 'systemctl --version | head -1; uname -r; . /etc/os-release; echo $PRETTY_NAME']).out.trim().split('\n');
    report(image, '-', 'boot', { systemd: versions[0], kernel: versions[1], os: versions[2] });

    // bus
    report(image, 'bus', 'tests', tests(sh(asWorker(name, [RUNTIME], TEST)).out));
    for (const p of probe(sh(asWorker(name, [RUNTIME], 'bun scripts/linux-scope-probe.ts kill breakaway nested')).out)) report(image, 'bus', 'probe', p);
    if (codex) {
      const installed = sh(asWorker(name, [], `mkdir -p ~/codex && cd ~/codex && bun add @openai/codex@${CODEX_VERSION} >/dev/null 2>&1; find ~/codex/node_modules/@openai -path '*/bin/codex' -type f | head -1`)).out.trim();
      if (!installed) report(image, 'bus', 'codex', { status: 'blocked', why: 'Codex CLI did not install' });
      else for (const p of probe(sh(asWorker(name, [RUNTIME, `SEISMIC_CODEX=${installed}`], 'bun scripts/linux-scope-probe.ts codex-close-tracker codex-close-scope codex-host-death-tracker codex-host-death-scope')).out)) report(image, 'bus', 'codex', p);
    }

    // ro-cgroup: the manager still moves the process; only this namespace's cgroupfs is read-only
    const ro = `unshare -m sh -c 'mount --bind /sys/fs/cgroup /sys/fs/cgroup && mount -o remount,bind,ro /sys/fs/cgroup && exec setpriv --reuid=1500 --regid=1500 --init-groups env HOME=/home/worker ${RUNTIME} PATH=$PATH sh -c "cd /w && bun scripts/linux-scope-probe.ts kill"'`;
    for (const p of probe(sh(['docker', 'exec', name, 'sh', '-c', ro]).out)) report(image, 'ro-cgroup', 'probe', p);

    // no-manager: a user whose manager does not run
    for (const p of probe(sh(['docker', 'exec', '-u', 'nolinger', '-w', '/w', '-e', 'XDG_RUNTIME_DIR=/run/user/1501', name, 'bun', 'scripts/linux-scope-probe.ts', 'kill']).out)) report(image, 'no-manager', 'probe', p);

    // no-dbus, last: it stops the bus for good
    sh(asWorker(name, [RUNTIME], 'systemctl --user stop dbus.socket dbus.service; mv /run/user/1500/bus /run/user/1500/bus.off'));
    const bus = sh(asWorker(name, [RUNTIME], 'systemctl --user is-active dbus.service; ls /run/user/1500')).out.trim().replace(/\n/g, ' ');
    report(image, 'no-dbus', 'state', { dbus: bus });
    report(image, 'no-dbus', 'tests', tests(sh(asWorker(name, [RUNTIME], TEST)).out));
    for (const p of probe(sh(asWorker(name, [RUNTIME], 'bun scripts/linux-scope-probe.ts kill')).out)) report(image, 'no-dbus', 'probe', p);
  } finally {
    sh(['docker', 'rm', '-f', name]);
  }
}

// unprivileged: an ordinary container, as CI or a dev container runs Seismic
const plain = sh(['docker', 'run', '--rm', '--init', '-u', '1500', '-e', 'HOME=/tmp', '-v', `${ROOT}:/w:ro`, '-w', '/w', `obeya-boundary-${images[0]}`, 'sh', '-c', `grep cgroup /proc/self/mounts; ${TEST}; bun scripts/linux-scope-probe.ts kill`]);
report(images[0]!, 'unprivileged', 'mounts', { cgroupfs: plain.out.split('\n').filter((l) => l.startsWith('cgroup')).join('; ') });
report(images[0]!, 'unprivileged', 'tests', tests(plain.out));
for (const p of probe(plain.out)) report(images[0]!, 'unprivileged', 'probe', p);
