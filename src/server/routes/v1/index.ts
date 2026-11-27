
import type { HttpRoute, RouteDependencies } from '../httpRoute';
import { Agents } from './agents';
import { Card } from './cards/_cardId';
import { Answer } from './cards/_cardId/answer';
import { Approve } from './cards/_cardId/approve';
import { Archive } from './cards/_cardId/archive';
import { CodeReview } from './cards/_cardId/code-review';
import { ReopenReviewItem } from './cards/_cardId/code-review/items/_itemNumber/reopen';
import { SkipCodeReview } from './cards/_cardId/code-review/skip';
import { StopCodeReview } from './cards/_cardId/code-review/stop';
import { EditHeld } from './cards/_cardId/edit-held';
import { Fold } from './cards/_cardId/fold';
import { HandOff } from './cards/_cardId/hand-off';
import { KeepMain } from './cards/_cardId/keep-main';
import { PushChanges } from './cards/_cardId/push-changes';
import { PushMain } from './cards/_cardId/push-main';
import { Dequeue } from './cards/_cardId/dequeue';
import { Message } from './cards/_cardId/message';
import { Pause } from './cards/_cardId/pause';
import { Restore } from './cards/_cardId/restore';
import { Resume } from './cards/_cardId/resume';
import { Share } from './cards/_cardId/share';
import { Snooze } from './cards/_cardId/snooze';
import { Start } from './cards/_cardId/start';
import { StartAt } from './cards/_cardId/start-at';
import { Stop } from './cards/_cardId/stop';
import { Unarchive } from './cards/_cardId/unarchive';
import { Wake } from './cards/_cardId/wake';
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
  return [Card, CodeReview, ReopenReviewItem, SkipCodeReview, StopCodeReview, EditHeld, Fold, HandOff, KeepMain, PushChanges, PushMain, Answer, Approve, Message, Pause, Resume, Snooze, StartAt, Wake, Archive, Dequeue, Restore, Share, Start, Stop, Unarchive, Chats, Chat, Open, Read, Unwait, RecentChat, Configuration, Health, Settings, Setting, Agents].map((Route) => new Route(dependencies));
}
