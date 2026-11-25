import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

/**
 * Type-check the desktop shell and its tests for Windows from macOS or Linux: `cargo check --tests`
 * for an installed `*-pc-windows-msvc` Rust target (`rustup target add aarch64-pc-windows-msvc`).
 * Nothing is linked, so stand-ins replace the MSVC headers, `lib.exe` and `llvm-rc` that build
 * scripts call; they live in /tmp, as CFLAGS cannot quote a path with spaces. On Windows, run `cargo test` in `desktop/` instead.
 * Usage: bun scripts/check-windows-build.ts [target triple] [extra cargo arguments]
 */
function main() {
  if (process.platform === 'win32') {
    console.error('On Windows, run `cargo test` in desktop/ instead.');
    return 2;
  }
  const [given, ...extra] = process.argv.slice(2);
  const installed = Bun.spawnSync(['rustup', 'target', 'list', '--installed']).stdout.toString().split('\n');
  const target = given ?? installed.find((t) => t.endsWith('-pc-windows-msvc'));
  if (!target || !installed.includes(target)) {
    console.error(`No Windows target installed: rustup target add ${target ?? 'aarch64-pc-windows-msvc'}`);
    return 2;
  }
  const stubs = mkdtempSync('/tmp/seismic-windows-check-');
  try {
    writeFileSync(join(stubs, 'assert.h'), '#define assert(x) ((void)0)\n');
    writeFileSync(join(stubs, 'string.h'), [
      '#include <stddef.h>',
      'void *memcpy(void *, const void *, size_t);',
      'void *memmove(void *, const void *, size_t);',
      'void *memset(void *, int, size_t);',
      'int memcmp(const void *, const void *, size_t);',
      'size_t strlen(const char *);',
    ].join('\n') + '\n');
    writeFileSync(join(stubs, 'stdlib.h'), '#include <stddef.h>\nvoid abort(void);\nvoid *malloc(size_t);\nvoid free(void *);\n');
    const lib = join(stubs, 'lib');
    writeFileSync(lib, [
      '#!/bin/sh',
      'out=""',
      'for a do shift; case "$a" in -out:*) out="${a#-out:}";; -nologo) ;; *) set -- "$@" "$a";; esac; done',
      'exec ar rcs "$out" "$@"',
    ].join('\n') + '\n');
    const rc = join(stubs, 'llvm-rc');
    writeFileSync(rc, [
      '#!/bin/sh',
      'prev=""',
      'for a in "$@"; do case "$prev" in /fo|-fo) : > "$a";; esac; prev="$a"; done',
    ].join('\n') + '\n');
    chmodSync(lib, 0o755);
    chmodSync(rc, 0o755);
    const variable = target.replaceAll('-', '_');
    const checked = Bun.spawnSync(['cargo', 'check', '--tests', '--target', target, ...extra], {
      cwd: join(ROOT, 'desktop'),
      stdio: ['inherit', 'inherit', 'inherit'],
      env: {
        ...process.env,
        PATH: `${stubs}:${process.env.PATH}`,
        [`CFLAGS_${variable}`]: `-I${stubs}`,
        [`AR_${variable}`]: lib,
        TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: null, resources: null } }),
      },
    });
    return checked.exitCode ?? 1;
  } finally {
    rmSync(stubs, { recursive: true, force: true });
  }
}

process.exit(main());
