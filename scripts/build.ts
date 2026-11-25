














import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import tailwind from 'bun-plugin-tailwind';
import pkg from '../package.json';

const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64'] as const;
type Target = (typeof TARGETS)[number];

const ROOT = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = resolve(outIndex >= 0 ? args[outIndex + 1]! : join(ROOT, 'dist'));
const named = args.filter((a, i) => !a.startsWith('--') && i !== outIndex + 1);
const here = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}` as Target;
const targets: Target[] = args.includes('--all') ? [...TARGETS] : named.length ? (named as Target[]) : [here];
for (const t of targets) if (!TARGETS.includes(t)) fail(`unknown target ${t} (known: ${TARGETS.join(', ')})`);

function fail(msg: string): never {
  console.error(`build: ${msg}`);
  process.exit(1);
}

function run(cmd: string[], cwd = ROOT) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) fail(`${cmd.join(' ')}\n${r.stdout.toString()}${r.stderr.toString()}`);
}

/** What goes among the resources: everything another process runs or imports, tests left out. */
function resources(dir: string) {
  const notTests = (src: string) => !/\.test\.ts$|__pycache__|\.DS_Store$/.test(src);
  cpSync(join(ROOT, 'plugin'), join(dir, 'plugin'), { recursive: true, filter: notTests });
  cpSync(join(ROOT, 'voice'), join(dir, 'voice'), { recursive: true, filter: notTests });
  
  cpSync(join(ROOT, 'node_modules', 'playwright-core'), join(dir, 'node_modules', 'playwright-core'), { recursive: true, dereference: true });
  
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'seismic-resources', version: pkg.version, private: true, type: 'module' }, null, 2)}\n`);
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));
  
  cpSync(join(ROOT, 'docs', 'site', 'reference', 'settings.md'), join(dir, 'docs', 'site', 'reference', 'settings.md'));
  for (const script of ['plugin/skills/demo/lib/recipe.ts', 'plugin/skills/settings/lib/check.ts', 'plugin/skills/settings/lib/allow-list.ts'])
    run([process.execPath, 'build', script, '--target', 'bun', '--outfile', join(dir, script)]);
  
  
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  run([process.execPath, 'build', 'scripts/agent-liveness-prototype.ts', '--target', 'bun', '--outfile', join(dir, 'scripts', 'agent-liveness.js')]);
}

const started = Date.now();
mkdirSync(out, { recursive: true });
for (const target of targets) {
  const dir = join(out, `seismic-${pkg.version}-${target}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const binary = join(dir, target.startsWith('windows') ? 'seismic.exe' : 'seismic');
  
  process.chdir(dir);
  
  
  const built = await Bun.build({
    entrypoints: [join(ROOT, 'src/server/main.ts')],
    compile: { target: `bun-${target}` as Bun.Build.CompileTarget, outfile: binary },
    splitting: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [tailwind],
  }).catch((e: unknown) => fail(String(e)));
  process.chdir(ROOT);
  if (!built.success) fail(built.logs.join('\n'));
  for (const f of readdirSync(dir)) if (f.endsWith('.bun-build')) rmSync(join(dir, f), { force: true });
  if (target.startsWith('darwin')) {
    if (process.platform === 'darwin') {
      run(['codesign', '--remove-signature', binary]);
      run(['codesign', '--sign', '-', '--force', binary]);
    } else console.warn(`build: ${target} is not signed (only a Mac signs): macOS kills it at start until it is`);
  }
  resources(join(dir, 'resources'));
  if (!existsSync(binary)) fail(`${binary} was not written`);
  console.log(`${relative(process.cwd(), dir) || '.'}  (${Math.round(Bun.file(binary).size / 1e6)} MB)`);
}
console.log(`built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
