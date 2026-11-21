/** The routes of Seismic's API under `/api/v1/`, each in the file its URL names. */
import type { HttpRoute, RouteDependencies } from '../httpRoute';
import { Card } from './cards/_cardId';
import { Archive } from './cards/_cardId/archive';
import { Restore } from './cards/_cardId/restore';
import { Share } from './cards/_cardId/share';
import { Unarchive } from './cards/_cardId/unarchive';

export function v1Routes(dependencies: RouteDependencies): HttpRoute[] {
  return [new Card(dependencies), new Archive(dependencies), new Restore(dependencies), new Share(dependencies), new Unarchive(dependencies)];
}
