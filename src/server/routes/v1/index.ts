/** The routes of Seismic's API under `/api/v1/`, each in the file its URL names. */
import type { HttpRoute, RouteDependencies } from '../httpRoute';
import { Share } from './cards/_cardId/share';

export function v1Routes(dependencies: RouteDependencies): HttpRoute[] {
  return [new Share(dependencies)];
}
