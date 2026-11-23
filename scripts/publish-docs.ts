// Publishes the user docs (docs/site/): moves the docs-vlatest tag to a commit on GitHub's main and
// pushes it. The push runs .github/workflows/docs-publish.yml, which has seismic-site deploy with
// the docs at the tag (docs/release.md, Publishing the docs).
//
//   bun scripts/publish-docs.ts [<commit>] [--force]      (or `just publish-docs`)
//       <commit> defaults to GitHub's main (origin/main, fetched first) and must be on it: the
//       site pulls the tag from GitHub. Stops without a change when docs/site/ is the same at
//       <commit> as at the tag; --force moves the tag anyway, for a redeploy of the same docs.
import { spawnSync } from 'node:child_process';
import { CHECKOUT, githubRepo } from './gh';

export const TAG = 'docs-vlatest';
const DOCS = 'docs/site';

export type Outcome =
  | { kind: 'published'; commit: string; from: string | null; changed: string[] }
  | { kind: 'unchanged'; commit: string; tagged: string }
  | { kind: 'refused'; reason: string };

export function publishDocs(cwd: string, { commit: wanted, force = false }: { commit?: string; force?: boolean } = {}): Outcome {
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const refused = (reason: string): Outcome => ({ kind: 'refused', reason });

  const fetched = git('fetch', '--quiet', 'origin', 'main');
  if (!fetched.ok) return refused(`could not fetch origin's main: ${fetched.err}`);
  const remote = git('ls-remote', 'origin', `refs/tags/${TAG}`);
  if (!remote.ok) return refused(`could not read ${TAG} on origin: ${remote.err}`);
  const tagged = remote.out.split(/\s+/)[0] || null;
  // the tag as GitHub has it, which a local one moved by hand may not be
  if (tagged && !git('fetch', '--quiet', 'origin', `+refs/tags/${TAG}:refs/tags/${TAG}`).ok) {
    return refused(`could not fetch ${TAG} from origin`);
  }

  const resolved = git('rev-parse', '--verify', '--quiet', `${wanted ?? 'origin/main'}^{commit}`);
  if (!resolved.ok) return refused(`no commit ${wanted}`);
  const commit = resolved.out;
  if (!git('merge-base', '--is-ancestor', commit, 'origin/main').ok) {
    return refused(`${commit.slice(0, 8)} is not on origin's main: push it first, the site pulls the tag from GitHub`);
  }
  const docs = git('ls-tree', '-r', '--name-only', commit, '--', DOCS).out.split('\n').filter(Boolean);
  if (!docs.length) return refused(`${commit.slice(0, 8)} has no ${DOCS}/`);

  if (tagged === commit && !force) return { kind: 'unchanged', commit, tagged };
  const changed = tagged ? git('diff', '--name-only', tagged, commit, '--', DOCS).out.split('\n').filter(Boolean) : docs;
  if (tagged && !changed.length && !force) return { kind: 'unchanged', commit, tagged };

  const moved = git('tag', '--force', TAG, commit);
  if (!moved.ok) return refused(`could not tag ${commit.slice(0, 8)}: ${moved.err}`);
  const pushed = git('push', '--quiet', 'origin', `+refs/tags/${TAG}:refs/tags/${TAG}`);
  if (!pushed.ok) return refused(`could not push ${TAG}: ${pushed.err}`);
  return { kind: 'published', commit, from: tagged, changed };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const commit = args.find((a) => !a.startsWith('--'));
  const outcome = publishDocs(CHECKOUT, { commit, force });
  const short = (hash: string) => hash.slice(0, 8);

  if (outcome.kind === 'refused') {
    console.error(`publish-docs: ${outcome.reason}`);
    process.exit(1);
  }
  if (outcome.kind === 'unchanged') {
    console.log(`publish-docs: ${DOCS}/ is the same at ${short(outcome.commit)} as at ${TAG} (${short(outcome.tagged)}); nothing to publish (--force redeploys it)`);
    process.exit(0);
  }
  const from = outcome.from ? `${short(outcome.from)} → ` : '';
  console.log(`publish-docs: ${TAG} ${from}${short(outcome.commit)}`);
  for (const file of outcome.changed) console.log(`  ${file}`);
  if (!outcome.changed.length) console.log('  (no docs changed: a redeploy)');
  const origin = spawnSync('git', ['-C', CHECKOUT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const repo = githubRepo(origin.stdout);
  if (repo) console.log(`The site deploys from https://github.com/${repo}/actions/workflows/docs-publish.yml`);
}
