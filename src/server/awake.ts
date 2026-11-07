// Keeping the machine awake for the owner's phone: while other devices may reach Seismic and a worker
// is in a turn (or its ended turn waits for its background work), or the whole time where the owner
// set so, the machine Seismic runs on does not idle-sleep, and a short while after that ends it sleeps
// again as it is set to. The display may still sleep, and a closed laptop lid puts the machine to sleep regardless. Per
// platform: `caffeinate -i -w <pid>` on macOS, `systemd-inhibit --what=idle:sleep` on Linux (both
// end with Seismic by themselves), `SetThreadExecutionState` on Windows, which holds as long as the
// process does. SSH hosts keep their own power settings.

import { OWN_GROUP } from './spawn';

/** An assertion taken: it holds until released, or until whatever holds it has gone. */
export interface Held {
  release(): void;
  /** Whether it still holds: a process that keeps it may have ended. */
  alive(): boolean;
  /** Why it stopped holding, once it no longer does. */
  why?(): string;
}

/** Takes the assertion; `null` where this machine offers none. */
export type Hold = () => Held;

const WHY = 'Other devices reach Seismic';

/** A process that keeps the assertion while it runs, also while Seismic waits for its workers after a Ctrl-C (`OWN_GROUP`). */
function holdingProcess(argv: string[]): Held {
  const p = Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', detached: OWN_GROUP });
  let stderr = '';
  void new Response(p.stderr).text().then((t) => (stderr = t.trim()));
  return {
    release: () => p.kill(),
    alive: () => p.exitCode === null && p.signalCode === null,
    why: () => stderr || `${argv[0]} ended (${p.exitCode ?? p.signalCode})`,
  };
}

/** How this platform keeps the machine from idle sleep for as long as process `pid` runs; `null` where it cannot. */
export function platformHold(platform: string = process.platform, pid = process.pid): Hold | null {
  if (platform === 'darwin') {
    const caffeinate = Bun.which('caffeinate') ?? '/usr/bin/caffeinate';
    return () => holdingProcess([caffeinate, '-i', '-w', String(pid)]);
  }
  if (platform === 'linux') {
    const inhibit = Bun.which('systemd-inhibit');
    const tail = Bun.which('tail');
    if (!inhibit || !tail) return null;
    return () => holdingProcess([inhibit, '--what=idle:sleep', '--who=Seismic', `--why=${WHY}`, '--mode=block', tail, `--pid=${pid}`, '-f', '/dev/null']);
  }
  if (platform === 'win32') {
    const ES_CONTINUOUS = 0x80000000;
    const ES_SYSTEM_REQUIRED = 0x00000001;
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const kernel32 = dlopen('kernel32.dll', { SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 } });
    // the state belongs to the calling thread, which is the JavaScript thread here and lives as long as Seismic
    return () => {
      const ok = kernel32.symbols.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) !== 0;
      return { release: () => void kernel32.symbols.SetThreadExecutionState(ES_CONTINUOUS), alive: () => ok, why: () => 'SetThreadExecutionState failed' };
    };
  }
  return null;
}

/** How long the machine stays awake after it was last wanted (the last worker's turn ended): the next turn often follows soon. */
export const LINGER_MS = 2 * 60_000;
/** How often whether it should stay awake is looked at. */
const EVERY_MS = 5_000;
/** After an assertion that would not hold, how long until it is tried again. */
const RETRY_MS = 5 * 60_000;

export interface AwakeOptions {
  /** Whether the machine should stay awake now: other devices may reach Seismic, and a worker works or the owner set it to stay awake. */
  wanted: () => boolean;
  hold?: Hold | null;
  lingerMs?: number;
  everyMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export class Awake {
  private readonly o: Required<Omit<AwakeOptions, 'hold'>> & { hold: Hold | null };
  private held: Held | null = null;
  /** When it was last wanted. */
  private lastWanted = -Infinity;
  /** Until when no new assertion is tried after one that would not hold. */
  private notBefore = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(o: AwakeOptions) {
    this.o = { lingerMs: LINGER_MS, everyMs: EVERY_MS, now: Date.now, log: (line) => console.log(line), ...o, hold: o.hold === undefined ? platformHold() : o.hold };
  }

  /** Looks every few seconds whether the machine should stay awake. */
  start() {
    this.timer ??= setInterval(() => this.check(), this.o.everyMs);
    this.timer.unref?.();
    this.check();
    return this;
  }

  /** Lets the machine sleep again at once and stops looking. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.letGo();
  }

  /** Whether Seismic keeps the machine awake now. */
  holding(): boolean {
    return !!this.held?.alive();
  }

  check() {
    const now = this.o.now();
    if (this.o.wanted()) this.lastWanted = now;
    const keep = now - this.lastWanted < this.o.lingerMs;
    if (this.held && !this.held.alive()) {
      this.o.log(`Seismic: could not keep this machine awake: ${this.held.why?.() ?? 'the assertion ended'}`);
      this.held = null;
      this.notBefore = now + RETRY_MS;
    }
    if (keep && !this.held && this.o.hold && now >= this.notBefore) {
      this.held = this.o.hold();
      this.o.log('Seismic: keeping this machine awake for other devices');
    }
    if (!keep) this.letGo();
  }

  private letGo() {
    if (!this.held) return;
    this.held.release();
    this.held = null;
    this.o.log('Seismic: this machine sleeps as it is set to again');
  }
}
