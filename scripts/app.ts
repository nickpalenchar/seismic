



















import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { replace } from './app-replace';
import { cargoPath } from './common';

const ROOT = resolve(import.meta.dir, '..');
const APP = join(ROOT, 'desktop');
const args = process.argv.slice(2);
const install = args[0] === 'install';
const debug = args.includes('--debug');
const target = join(APP, 'target', 'checkout');

const NAME = 'Seismic (checkout)';
const IDENTIFIER = 'im.seismic.checkout';

function fail(msg: string): never {
  console.error(`app: ${msg}`);
  process.exit(1);
}


const config: Record<string, unknown> = { bundle: { externalBin: null, resources: null } };
const env: Record<string, string | undefined> = { ...process.env, PATH: cargoPath(), CARGO_TARGET_DIR: target, CI: 'true' };
if (install) {
  const git = (...a: string[]) => {
    const r = Bun.spawnSync(['git', ...a], { cwd: ROOT, stderr: 'ignore' });
    return r.exitCode === 0 ? r.stdout.toString().trim() : '';
  };
  Object.assign(config, { identifier: IDENTIFIER });
  Object.assign(env, {
    
    SEISMIC_BUILT_CHECKOUT: ROOT,
    
    
    SEISMIC_BUILT_BUN: (process.env.SEISMIC_BUN ?? process.env.OBEYA_BUN) || Bun.which('bun') || process.execPath,
    SEISMIC_BUILT_TREE: git('rev-parse', 'HEAD:desktop'),
    
    SEISMIC_BUILT_COMMIT: git('rev-parse', 'HEAD'),
  });
}

const bundle = install && process.platform === 'darwin' ? ['--bundles', 'app'] : ['--no-bundle'];
const build = Bun.spawnSync([process.execPath, 'x', 'tauri', 'build', ...bundle, '--config', JSON.stringify(config), ...(debug ? ['--debug'] : [])], {
  cwd: APP,
  stdout: 'inherit',
  stderr: 'inherit',
  env,
});
if (build.exitCode !== 0) fail('the shell did not build (Rust from https://rustup.rs is needed)');

const built = join(target, debug ? 'debug' : 'release');
const program = join(built, process.platform === 'win32' ? 'seismic.exe' : 'seismic');

if (!install) {
  const shell = Bun.spawn([program], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, SEISMIC_CHECKOUT: ROOT, SEISMIC_BUN: process.execPath },
  });
  process.exit(await shell.exited);
}

if (args.includes('--build-only')) process.exit(0);

/** Puts `from` at `to`, also while the app at `to` runs (app-replace.ts). */
function put(from: string, to: string) {
  try {
    replace(from, to);
  } catch (e) {
    fail((e as Error).message);
  }
}

let start: string[];
if (process.platform === 'darwin') {
  const apps = join(homedir(), 'Applications');
  mkdirSync(apps, { recursive: true });
  const dest = join(apps, `${NAME}.app`);
  put(join(built, 'bundle', 'macos', 'Seismic.app'), dest);
  console.log(`app: installed ${dest}`);
  start = ['open', dest];
} else if (process.platform === 'win32') {
  const dir = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'Seismic checkout');
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, 'seismic.exe');
  put(program, exe);
  const menu = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const link = join(menu, `${NAME}.lnk`);
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const made = Bun.spawnSync([
    'powershell',
    '-NoProfile',
    '-Command',
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(link)}); $s.TargetPath = ${quote(exe)}; $s.WorkingDirectory = ${quote(dir)}; $s.Save()`,
  ]);
  if (made.exitCode !== 0) fail(`could not put ${NAME} into the Start menu: ${made.stderr.toString().trim()}`);
  console.log(`app: installed ${exe}, in the Start menu as ${NAME}`);
  start = [exe];
} else {
  const data = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const dir = join(data, 'seismic-checkout');
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, 'seismic');
  put(program, exe);
  const icon = join(dir, 'seismic.png');
  copyFileSync(join(APP, 'icons', '128x128@2x.png'), icon);
  const entries = join(data, 'applications');
  mkdirSync(entries, { recursive: true });
  const desktop = ['[Desktop Entry]', 'Type=Application', `Name=${NAME}`, 'Comment=A project for directing AI coding agents', `Exec="${exe}"`, `Icon=${icon}`, 'Terminal=false', 'Categories=Development;', 'StartupWMClass=seismic', ''];
  writeFileSync(join(entries, 'seismic-checkout.desktop'), desktop.join('\n'));
  if (Bun.which('update-desktop-database')) Bun.spawnSync(['update-desktop-database', entries]);
  console.log(`app: installed ${exe}, in the applications menu as ${NAME}`);
  start = [exe];
}

if (!args.includes('--no-open')) {
  
  spawn(start[0]!, start.slice(1), { detached: true, stdio: 'ignore' }).unref();
}
