export type Env = Record<string, string | undefined>;

/**
 * An environment variable of Seismic by its name without the prefix: `SEISMIC_<name>`, else
 * `OBEYA_<name>`, the name from before the rename (older checkouts, running agents and scripts still set it).
 */
export function seismicEnv(name: string, env: Env = process.env): string | undefined {
  return env[`SEISMIC_${name}`] ?? env[`OBEYA_${name}`];
}

/** Both names set to one value, for what Seismic hands to processes that may be older than the rename. */
export function bothNames(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).flatMap(([k, v]) => [[`SEISMIC_${k}`, v], [`OBEYA_${k}`, v]]));
}
