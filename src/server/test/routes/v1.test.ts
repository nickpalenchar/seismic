import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';
import { HttpRoute } from '../../routes/httpRoute';
import { v1Routes } from '../../routes/v1';
import { CardService } from '../../services/cardService';
import { ConfigurationService } from '../../services/configurationService';
import { HintsService } from '../../services/hintsService';
import { ProjectService } from '../../services/projectService';
import { Store } from '../../store';
import { serverDir } from '../helpers/paths';

const v1Dir = join(serverDir, 'routes', 'v1');
const store = new Store(':memory:');
const routes = v1Routes({
  cardService: new CardService(store.cardRepository, () => []),
  projectService: new ProjectService(() => undefined, () => [], () => undefined),
  hintsService: new HintsService(store.hintRepository),
  configurationService: new ConfigurationService(undefined, undefined, undefined),
});

/** The URL a route file's path names: `/api/v1/` and its path, `_x` read as `:x`. */
const urlOf = (file: string) => `/api/v1/${file.replace(/\.ts$/, '').split('/').map((segment) => (segment.startsWith('_') ? `:${segment.slice(1)}` : segment)).join('/')}`;

test('every route under routes/v1/ is at the URL its file names, and is registered', async () => {
  const files = [...new Glob('**/*.ts').scanSync(v1Dir)].filter((file) => file !== 'index.ts');
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const exported = Object.values(await import(join(v1Dir, file))).filter(
      (value): value is abstract new (...services: never[]) => HttpRoute => typeof value === 'function' && value.prototype instanceof HttpRoute,
    );
    expect(exported.length, file).toBeGreaterThan(0);
    for (const Route of exported) {
      const registered = routes.find((route) => route instanceof Route);
      expect(registered, `${file} is registered`).toBeDefined();
      expect(registered!.path, file).toBe(urlOf(file));
    }
  }
});
