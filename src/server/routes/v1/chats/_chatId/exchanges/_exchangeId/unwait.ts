import type { ProjectService } from '../../../../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../../../../httpRoute';

/** The owner no longer wants the step Seismic waits on a card for after the exchange ("Stop waiting"). */
export class Unwait extends HttpRoute {
  readonly path = '/api/v1/chats/:chatId/exchanges/:exchangeId/unwait';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ stopped: boolean }> => {
    const { project, chat } = await this.projectService.getProjectRuntimeForChat(request.params.chatId!);
    const exchange = Number(request.params.exchangeId);
    const { card } = await this.bodyOf(request);
    const waiting = project.board.waitingTalk().some((x) => x.id === exchange && x.chat === chat);
    return { stopped: waiting && project.commander.unwait(exchange, String(card ?? '')) };
  };
}
