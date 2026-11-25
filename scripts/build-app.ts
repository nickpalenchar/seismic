































import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pkg from '../package.json';
import { endingIn, opt } from './common';

const TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'windows-x64': 'x86_64-pc-windows-msvc',
} as const;
type Target = keyof typeof TRIPLES;

const ROOT = resolve(import.meta.dir, '..');
const APP = join(ROOT, 'desktop');
const args = process.argv.slice(2);
const here = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}` as Target;
const target = (args.find((a, i) => !a.startsWith('--') && !['--bundles', '--config'].includes(args[i - 1] ?? '')) ?? here) as Target;
if (!(target in TRIPLES)) fail(`unknown target ${target} (known: ${Object.keys(TRIPLES).join(', ')})`);
const triple = TRIPLES[target];
const os = target.split('-')[0];
const bundles = opt('bundles') ?? (os === 'darwin' ? 'dmg' : os === 'windows' ? 'nsis' : 'appimage,deb');

function fail(msg: string): never {
  console.error(`build-app: ${msg}`);
  process.exit(1);
}

function run(cmd: string[], cwd = ROOT, env: Record<string, string> = {}) {
  console.log(`$ ${cmd.join(' ')}`);
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...env } });
  if (r.exitCode !== 0) fail(`${cmd[0]} failed (exit ${r.exitCode})`);
}

/** `run`, tried again after a pause when it fails: stapler fetches the ticket from Apple's CloudKit,
 * which now and then drops the connection for a quarter of an hour (NSURLErrorDomain -1005, the
 * Intel Mac runner twice for v0.2.0, 2026-10-13), and stapling or validating again is harmless. */
function persist(cmd: string[], pauses = [30, 60, 120, 240, 300]) {
  for (const pause of pauses) {
    console.log(`$ ${cmd.join(' ')}`);
    const r = Bun.spawnSync(cmd, { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
    if (r.exitCode === 0) return;
    console.warn(`build-app: ${cmd[0]} failed (exit ${r.exitCode}), again in ${pause} s`);
    Bun.sleepSync(pause * 1000);
  }
  run(cmd);
}

/** What `cmd` prints, failing with what it said when it fails. */
function output(cmd: string[], cwd = ROOT): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const said = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) fail(`${cmd.slice(0, 3).join(' ')} failed (exit ${r.exitCode})\n${said}`);
  return said;
}


const APPLE = ['APPLE_SIGNING_IDENTITY', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_NOTARY_KEY', 'APPLE_NOTARY_KEY_ID', 'APPLE_NOTARY_ISSUER'];
for (const name of APPLE) if (!process.env[name]) delete process.env[name];

const started = Date.now();
const dist = join(ROOT, 'dist');
run([process.execPath, 'scripts/build.ts', target, '--out', dist]);
const built = join(dist, `seismic-${pkg.version}-${target}`);
const exe = os === 'windows' ? '.exe' : '';


mkdirSync(join(APP, 'binaries'), { recursive: true });
cpSync(join(built, `seismic${exe}`), join(APP, 'binaries', `seismic-server-${triple}${exe}`));
rmSync(join(APP, 'staged'), { recursive: true, force: true });
cpSync(join(built, 'resources'), join(APP, 'staged', 'resources'), { recursive: true });

if (os === 'linux') cpSync(join(built, 'seismic'), join(APP, 'staged', 'seismic-server'));

const cross = target !== here;
const out = join(APP, 'target', ...(cross ? [triple] : []), args.includes('--debug') ? 'debug' : 'release', 'bundle');

rmSync(out, { recursive: true, force: true });
const developerId = os === 'darwin' && !!(process.env.APPLE_SIGNING_IDENTITY || process.env.APPLE_CERTIFICATE);

const signing = developerId ? ['--config', JSON.stringify({ bundle: { macOS: { signingIdentity: process.env.APPLE_SIGNING_IDENTITY ?? null } } })] : [];
const tauri = (bundles: string, ...more: string[]) =>
  run(
    [process.execPath, 'x', 'tauri', 'build', '--bundles', bundles, ...(cross ? ['--target', triple] : []), ...(args.includes('--debug') ? ['--debug'] : []), ...(args.includes('--verbose') ? ['--verbose'] : []), ...(opt('config') ? ['--config', opt('config')!] : []), ...signing, ...more],
    APP,
    { CI: 'true' },
  );
const wanted = bundles.split(',');

if (os === 'darwin' && process.env.TAURI_SIGNING_PRIVATE_KEY && !wanted.includes('app')) wanted.unshift('app');
if (wanted.includes('appimage')) {
  if (wanted.length > 1) tauri(wanted.filter((b) => b !== 'appimage').join(','));
  
  
  
  tauri('appimage', '--config', JSON.stringify({ bundle: { resources: { 'staged/seismic-server': null } } }));
  const appdir = join(out, 'appimage', `Seismic.AppDir`);
  const server = join(appdir, 'usr', 'lib', 'Seismic', 'seismic-server');
  cpSync(join(APP, 'staged', 'seismic-server'), server);
  chmodSync(server, 0o755);
  const cache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'tauri');
  const packer = readdirSync(cache).find((f) => f.startsWith('linuxdeploy-plugin-appimage') && f.endsWith('.AppImage'));
  if (!packer) fail(`no linuxdeploy-plugin-appimage in ${cache}`);
  const image = readdirSync(join(out, 'appimage')).find((f) => f.endsWith('.AppImage'));
  if (!image) fail('Tauri wrote no AppImage');
  run([join(cache, packer), '--appdir', appdir], join(out, 'appimage'), { OUTPUT: image, ARCH: target.endsWith('arm64') ? 'aarch64' : 'x86_64', APPIMAGE_EXTRACT_AND_RUN: '1' });
} else tauri(wanted.join(','));

if (!existsSync(out)) fail(`${out} was not written`);

if (developerId && process.env.APPLE_NOTARY_KEY && process.env.APPLE_NOTARY_KEY_ID) notarise();
else if (developerId) console.warn('build-app: signed with the Developer ID, but not notarised (no APPLE_NOTARY_KEY and APPLE_NOTARY_KEY_ID)');

/** Has Apple notarise the DMG (else the app, zipped) and staples the ticket to the DMG and the app. */
function notarise() {
  const tmp = mkdtempSync(join(tmpdir(), 'seismic-notary-'));
  try {
    const given = process.env.APPLE_NOTARY_KEY!;
    const key = given.includes('BEGIN PRIVATE KEY') ? join(tmp, 'key.p8') : given;
    if (key !== given) writeFileSync(key, given);
    const auth = ['--key', key, '--key-id', process.env.APPLE_NOTARY_KEY_ID!, ...(process.env.APPLE_NOTARY_ISSUER ? ['--issuer', process.env.APPLE_NOTARY_ISSUER] : [])];
    const app = join(out, 'macos', 'Seismic.app');
    const dmg = endingIn(join(out, 'dmg'), '.dmg');
    const submitted = dmg ?? join(tmp, 'Seismic.zip');
    if (!dmg) run(['ditto', '-c', '-k', '--keepParent', app, submitted]);
    console.log(`$ xcrun notarytool submit ${submitted} --wait`);
    const answer = JSON.parse(output(['xcrun', 'notarytool', 'submit', submitted, ...auth, '--wait', '--timeout', '1h', '--output-format', 'json'])) as { id: string; status: string };
    if (answer.status !== 'Accepted') {
      console.error(output(['xcrun', 'notarytool', 'log', answer.id, ...auth]));
      fail(`notarisation ${answer.id}: ${answer.status}`);
    }
    console.log(`notarised (${answer.id})`);
    
    
    for (const file of [...(dmg ? [dmg] : []), ...(existsSync(app) ? [app] : [])]) {
      persist(['xcrun', 'stapler', 'staple', file]);
      persist(['xcrun', 'stapler', 'validate', file]);
    }
    
    const assess = (...check: string[]) => {
      const said = output(['spctl', '--assess', '-vv', ...check]);
      if (!said.includes('Notarized Developer ID')) fail(`Gatekeeper: ${said}`);
      console.log(said.trim());
    };
    if (dmg) {
      assess('--type', 'open', '--context', 'context:primary-signature', submitted);
      const mounted = join(tmp, 'dmg');
      output(['hdiutil', 'attach', '-nobrowse', '-readonly', '-mountpoint', mounted, submitted]);
      try {
        assess('--type', 'execute', join(mounted, 'Seismic.app'));
      } finally {
        run(['hdiutil', 'detach', mounted]);
      }
    } else assess('--type', 'execute', app);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const sign = (file: string) => run([process.execPath, 'x', 'tauri', 'signer', 'sign', file], APP);
  const one = (sub: string, end: string) => endingIn(join(out, sub), end) ?? fail(`no ${end} in ${join(out, sub)} to sign for the updater`);
  if (os === 'darwin') {
    
    run(['tar', '-czf', 'Seismic.app.tar.gz', 'Seismic.app'], join(out, 'macos'), { COPYFILE_DISABLE: '1' });
    sign(join(out, 'macos', 'Seismic.app.tar.gz'));
  } else if (os === 'windows' && wanted.includes('nsis')) sign(one('nsis', '-setup.exe'));
  else if (wanted.includes('appimage')) sign(one('appimage', '.AppImage'));
}
console.log(`\n${out}\nbuilt in ${((Date.now() - started) / 1000).toFixed(0)} s`);
