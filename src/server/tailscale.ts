// Tailscale on this machine, for other devices to reach Seismic (remote.ts): what `tailscale status`
// says it allows, and the one `tailscale serve` entry Seismic keeps, which proxies HTTPS at the
// machine's tailnet name to Seismic's port on 127.0.0.1. Seismic touches no other entry: one on a port
// that serves something else stays, and Seismic takes the next port.

import { existsSync } from 'node:fs';
import type { RemoteProblem, TailscaleState } from '../core/types';

/** The HTTPS ports Seismic tries in turn (those the tailnet also lets Funnel use, which every client knows). */
export const SERVE_PORTS = [443, 8443, 10000] as const;

/** The entry Seismic serves: HTTPS on `https` of the tailnet name, proxied to `target`. */
export interface ServeEntry {
  https: number;
  target: string;
}

/** Where Tailscale's CLI is: on the PATH, else where its app for the platform puts it. */
export function findTailscale(platform = process.platform): string | null {
  const onPath = Bun.which('tailscale');
  if (onPath) return onPath;
  const known =
    platform === 'darwin' ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : null;
  return known && existsSync(known) ? known : null;
}

interface Status {
  BackendState?: string;
  CertDomains?: string[] | null;
  Self?: { DNSName?: string; UserID?: number };
  Peer?: Record<string, unknown> | null;
  User?: Record<string, { LoginName?: string }> | null;
}

interface ServeConfig {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
}

export class Tailscale {
  /** What `state` found last, once Tailscale answered. */
  private last: TailscaleState | undefined;

  constructor(
    /** Its CLI; `null` where it is not installed. */
    private readonly bin: string | null = findTailscale(),
    private readonly platform = process.platform,
    /** How long `tailscale status` may take. */
    private readonly statusTimeout = 10_000,
  ) {}

  private async run(args: string[], timeout = 10_000): Promise<{ ok: boolean; out: string; late?: true }> {
    const p = Bun.spawn([this.bin!, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    // a CLI newer than its service warns about it on stderr: only the output counts
    return { ok: code === 0, out: code === 0 ? out : `${out}\n${err}`.trim(), ...(p.signalCode ? { late: true as const } : {}) };
  }

  /** What Tailscale allows here now. */
  async state(): Promise<TailscaleState> {
    if (!this.bin) return { state: 'missing' };
    let status: Status;
    try {
      const r = await this.run(['status', '--json'], this.statusTimeout);
      // on a machine under load the answer can take longer than it may: that says nothing new
      if (r.late && this.last) return this.last;
      status = JSON.parse(r.out.slice(r.out.indexOf('{'))) as Status;
    } catch {
      return (this.last = { state: 'stopped' });
    }
    return (this.last = this.stateOf(status));
  }

  private stateOf(status: Status): TailscaleState {
    const name = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase();
    if (status.BackendState === 'NeedsLogin' || status.BackendState === 'NeedsMachineAuth' || status.BackendState === 'NoState') return { state: 'loggedOut' };
    if (status.BackendState !== 'Running' || !name) return { state: 'stopped' };
    if (!status.CertDomains?.length) return { state: 'noHttps', name };
    const account = status.User?.[String(status.Self?.UserID)]?.LoginName;
    return { state: 'ready', name, ...(account ? { account } : {}), others: Object.keys(status.Peer ?? {}).length };
  }

  private async config(): Promise<ServeConfig> {
    const r = await this.run(['serve', 'status', '--json']);
    if (!r.ok) throw new Error(r.out);
    const at = r.out.indexOf('{');
    return at < 0 ? {} : (JSON.parse(r.out.slice(at)) as ServeConfig);
  }

  /**
   * Serves Seismic's `port` at `name` over HTTPS: on the port of `kept` (the entry Seismic served
   * before, while it is still Seismic's), else on the first of `SERVE_PORTS` nothing serves yet.
   */
  async serve(name: string, port: number, kept: ServeEntry | null): Promise<{ entry: ServeEntry } | { problem: RemoteProblem }> {
    const target = `http://127.0.0.1:${port}`;
    let config: ServeConfig;
    try {
      config = await this.config();
    } catch (e) {
      return { problem: this.problemOf((e as Error).message) };
    }
    const proxy = (https: number) => config.Web?.[`${name}:${https}`]?.Handlers?.['/']?.Proxy;
    const already = SERVE_PORTS.find((p) => proxy(p) === target);
    if (already) return { entry: { https: already, target } };
    const https = kept && proxy(kept.https) === kept.target ? kept.https : SERVE_PORTS.find((p) => !config.TCP?.[String(p)]);
    if (!https) return { problem: { code: 'portsTaken' } };
    // the tailnet may ask for HTTPS to be turned on and wait for it: the state says so beforehand, the timeout ends the wait
    const r = await this.run(['serve', '--bg', `--https=${https}`, target], 20_000);
    return r.ok ? { entry: { https, target } } : { problem: this.problemOf(r.out) };
  }

  /** Removes the entry Seismic served, if it is still Seismic's. */
  async unserve(name: string, entry: ServeEntry): Promise<void> {
    const config = await this.config().catch(() => ({}) as ServeConfig);
    if (config.Web?.[`${name}:${entry.https}`]?.Handlers?.['/']?.Proxy !== entry.target) return;
    await this.run(['serve', `--https=${entry.https}`, 'off']);
  }

  /** As `unserve`, waiting for it: Seismic stopping, which ends the process right after. */
  unserveSync(name: string, entry: ServeEntry) {
    const run = (args: string[]) => Bun.spawnSync([this.bin!, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
    const status = run(['serve', 'status', '--json']);
    try {
      const out = status.stdout.toString();
      const config = (out.includes('{') ? JSON.parse(out.slice(out.indexOf('{'))) : {}) as ServeConfig;
      if (config.Web?.[`${name}:${entry.https}`]?.Handlers?.['/']?.Proxy === entry.target) run(['serve', `--https=${entry.https}`, 'off']);
    } catch {}
  }

  private problemOf(output: string): RemoteProblem {
    if (this.platform === 'linux' && /access denied/i.test(output)) return { code: 'operator' };
    return { code: 'failed', detail: output.trim().split('\n').filter((l) => !/client version .* != tailscaled/.test(l)).join('\n') || 'tailscale serve failed' };
  }
}
