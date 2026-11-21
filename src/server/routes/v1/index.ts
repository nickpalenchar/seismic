/** The routes of Seismic's API under `/api/v1/`, each in the file its URL names. */
import type { HttpRoute, RouteDependencies } from '../httpRoute';
import { Card } from './cards/_cardId';
import { Approve } from './cards/_cardId/approve';
import { Archive } from './cards/_cardId/archive';
import { Restore } from './cards/_cardId/restore';
import { Share } from './cards/_cardId/share';
import { Start } from './cards/_cardId/start';
import { Stop } from './cards/_cardId/stop';
import { Unarchive } from './cards/_cardId/unarchive';

export function v1Routes(dependencies: RouteDependencies): HttpRoute[] {
  return [Card, Approve, Archive, Restore, Share, Start, Stop, Unarchive].map((Route) => new Route(dependencies));
}
