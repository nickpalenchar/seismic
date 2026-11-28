import type { ProjectService } from '../../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner goes back to the chat: new words go into it from now on. A chat left without a word in it goes. */
export class Open extends HttpRoute {
  readonly path = '/api/v1/chats/:chatId/open';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ chat: number }> => {
    const { project, chat } = await this.projectService.getProjectRuntimeForChat(request.params.chatId!);
    project.board.openChat(chat);
    return { chat };
  };
}
