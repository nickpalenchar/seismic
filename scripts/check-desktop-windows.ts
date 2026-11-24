// Type-checks the desktop shell for Windows from macOS or Linux, so code behind `#[cfg(windows)]`
// is compiled before it reaches a Windows machine. Nothing is linked: ring's C sources compile
// against stub headers, and the archiver and resource compiler are stubs that write empty files.
//
//   bun scripts/check-desktop-windows.ts [cargo check arguments]
//
// Needs the target: `rustup target add aarch64-pc-windows-msvc`.

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TARGET = 'aarch64-pc-windows-msvc';
const desktop = resolve(import.meta.dir, '..', 'desktop');
const stubs = mkdtempSync(join(tmpdir(), 'seismic-windows-check-'));
const write = (name: string, text: string, executable = false) => {
  writeFileSync(join(stubs, name), text);
  if (executable) chmodSync(join(stubs, name), 0o755);
};
write('assert.h', '#pragma once\n#define assert(x) ((void)0)\n#define static_assert _Static_assert\n');
write('string.h', '#pragma once\n#include <stddef.h>\nvoid *memcpy(void *, const void *, size_t);\nvoid *memmove(void *, const void *, size_t);\nvoid *memset(void *, int, size_t);\nint memcmp(const void *, const void *, size_t);\nsize_t strlen(const char *);\n');
write('stdlib.h', '#pragma once\n#include <stddef.h>\nvoid abort(void);\n');
write('lib', '#!/bin/sh\nfor a in "$@"; do case "$a" in -out:*|/OUT:*|/out:*) : > "${a#*:}";; esac; done\n', true);
write('rc', '#!/bin/sh\nfor a in "$@"; do [ "$a" = "/?" ] && { echo "OVERVIEW: Resource Converter"; echo "/no-preprocess"; exit 0; }; done\nnext=0\nfor a in "$@"; do [ $next = 1 ] && : > "$a"; next=0; case "$a" in /fo) next=1;; /fo*) : > "${a#/fo}";; esac; done\n', true);

// tauri-build looks for the server the bundle would carry
const sidecar = join(desktop, 'binaries', `seismic-server-${TARGET}.exe`);
const placeholder = !existsSync(sidecar);
if (placeholder) writeFileSync(sidecar, '');
const cargoBin = join(homedir(), '.cargo', 'bin');
try {
  const run = Bun.spawnSync(['cargo', 'check', '--target', TARGET, ...process.argv.slice(2)], {
    cwd: desktop,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PATH: `${cargoBin}:${process.env.PATH}`,
      [`CFLAGS_${TARGET.replaceAll('-', '_')}`]: `-I${stubs}`,
      [`AR_${TARGET.replaceAll('-', '_')}`]: join(stubs, 'lib'),
      [`RC_${TARGET.replaceAll('-', '_')}`]: join(stubs, 'rc'),
    },
  });
  process.exitCode = run.exitCode ?? 1;
} finally {
  if (placeholder) rmSync(sidecar, { force: true });
  rmSync(stubs, { recursive: true, force: true });
}
