import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';
import { HttpRoute, type RouteDependencies } from '../../routes/httpRoute';
import { v1Routes } from '../../routes/v1';
import { CardService } from '../../services/cardService';
import { HintRepository } from '../../repositories/hintRepository';
import { HintsService } from '../../services/hintsService';
import { Store } from '../../store';
import { serverDir } from '../helpers/paths';

const v1Dir = join(serverDir, 'routes', 'v1');
const dependencies: RouteDependencies = { cards: new CardService(() => []), projectById: () => undefined, projectOfChat: () => undefined, allProjects: () => [], hints: new HintsService(new HintRepository(new Store(':memory:').database)) };

/** The URL a route file's path names: `/api/v1/` and its path, `_x` read as `:x`. */
const urlOf = (file: string) => `/api/v1/${file.replace(/\.ts$/, '').split('/').map((segment) => (segment.startsWith('_') ? `:${segment.slice(1)}` : segment)).join('/')}`;

test('every route under routes/v1/ is at the URL its file names, and is registered', async () => {
  const files = [...new Glob('**/*.ts').scanSync(v1Dir)].filter((file) => file !== 'index.ts');
  expect(files.length).toBeGreaterThan(0);
  const registered = v1Routes(dependencies).map((route) => route.path);
  for (const file of files) {
    const exported = Object.values(await import(join(v1Dir, file))).filter(
      (value): value is new (d: RouteDependencies) => HttpRoute => typeof value === 'function' && value.prototype instanceof HttpRoute,
    );
    expect(exported.length, file).toBeGreaterThan(0);
    for (const Route of exported) {
      expect(new Route(dependencies).path, file).toBe(urlOf(file));
      expect(registered, file).toContain(urlOf(file));
    }
  }
});
