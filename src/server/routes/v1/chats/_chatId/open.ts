import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner goes back to the chat: new words go into it from now on. A chat left without a word in it goes. */
export class Open extends HttpRoute {
  readonly path = '/api/v1/chats/:chatId/open';

  override POST = (request: RouteRequest): { chat: number } => {
    const { project, chat } = this.projectOfChat(request);
    project.board.openChat(chat);
    return { chat };
  };
}
