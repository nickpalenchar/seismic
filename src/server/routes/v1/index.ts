
import type { HttpRoute, RouteDependencies } from '../httpRoute';
import { Card } from './cards/_cardId';
import { Approve } from './cards/_cardId/approve';
import { Archive } from './cards/_cardId/archive';
import { Dequeue } from './cards/_cardId/dequeue';
import { Restore } from './cards/_cardId/restore';
import { Share } from './cards/_cardId/share';
import { Start } from './cards/_cardId/start';
import { Stop } from './cards/_cardId/stop';
import { Unarchive } from './cards/_cardId/unarchive';
import { Chats } from './chats';
import { Chat } from './chats/_chatId';
import { Unwait } from './chats/_chatId/exchanges/_exchangeId/unwait';
import { Open } from './chats/_chatId/open';
import { Read } from './chats/_chatId/read';
import { RecentChat } from './chats/recent';
import { Configuration } from './configuration';
import { Health } from './health';
import { Settings } from './settings';
import { Setting } from './settings/_settingName';

export function v1Routes(dependencies: RouteDependencies): HttpRoute[] {
  return [Card, Approve, Archive, Dequeue, Restore, Share, Start, Stop, Unarchive, Chats, Chat, Open, Read, Unwait, RecentChat, Configuration, Health, Settings, Setting].map((Route) => new Route(dependencies));
}
