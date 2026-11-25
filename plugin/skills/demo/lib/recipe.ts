



import { readShared } from '../../../../src/adapters/index.ts';
import { repoInfo } from '../../../../src/server/repo.ts';

try {
  const run = readShared(repoInfo(process.cwd()).path).settings?.app?.run;
  console.log(run || 'No recipe for this repository: its own docs say how to start it.');
} catch (e) {
  console.log(`No recipe: ${e instanceof Error ? e.message : e}. Run it in the repository whose app the demo shows.`);
}
