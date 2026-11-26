import { HttpRoute, type RouteRequest } from '../../httpRoute';

export interface RecentChatView {
  chat: { id: number; at: string } | null;
}

/**
 * The chat the owner talked in last on the project (`?project=`), and when: what the chat panel
 * resumes when it opens soon after it closed. `null` while nothing was said in any chat.
 */
export class RecentChat extends HttpRoute {
  readonly path = '/api/v1/chats/recent';

  override GET = (request: RouteRequest): RecentChatView => ({ chat: this.projectOfId(new URL(request.url).searchParams.get('project')).board.recentChat() });
}
