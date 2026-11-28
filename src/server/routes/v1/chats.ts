import type { ChatElsewhere } from '../../../core/types';
import type { ProjectService } from '../../services/projectService';
import { HttpRoute, type RouteRequest } from '../httpRoute';

/**
 * The chats with Seismic: every project's, the latest first (the menu's "all projects"), and a new
 * chat on a project (`{ project }`), answered with its id. A chat with nothing said in it is
 * reused, so asking again makes no second one.
 */
export class Chats extends HttpRoute {
  readonly path = '/api/v1/chats';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override GET = async (): Promise<{ chats: ChatElsewhere[] }> => {
    const projects = await this.projectService.getProjectRuntimes();
    const names = new Map(projects.map((project) => [project.board.project.id, project.board.project.name]));
    const chats = (projects[0]?.board.everyChat() ?? []).flatMap((chat) => (names.has(chat.project) ? [{ ...chat, projectName: names.get(chat.project)! }] : []));
    return { chats };
  };

  override POST = async (request: RouteRequest): Promise<{ chat: number }> => {
    const { project } = await this.bodyOf(request);
    return { chat: (await this.projectService.getProjectRuntime(typeof project === 'string' ? project : null)).board.newChat() };
  };
}
