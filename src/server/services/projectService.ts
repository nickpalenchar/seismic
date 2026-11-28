import { NotFound } from '../notFound';
import type { ProjectRuntime } from '../project';

/**
 * Which project a thing belongs to, across the projects that run: the project by its id, and the one
 * a group, a canvas or a chat is on. An unknown one is refused with `NotFound`.
 */
export class ProjectService {
  constructor(
    private readonly projectById: (projectId: string) => ProjectRuntime | undefined,
    private readonly projects: () => ProjectRuntime[],
    private readonly projectOfChat: (chatId: number) => ProjectRuntime | undefined,
  ) {}

  /** The projects that run. */
  async getProjectRuntimes(): Promise<ProjectRuntime[]> {
    return this.projects();
  }

  /** The project with this id (a `?project=` or a body field); none sent, or an unknown one, is refused. */
  async getProjectRuntime(projectId: string | null): Promise<ProjectRuntime> {
    const project = projectId ? this.projectById(projectId) : undefined;
    if (!project) throw new NotFound('unknownProject', 'unknown project');
    return project;
  }

  /** The project of this group. */
  async getProjectRuntimeForGroup(groupId: string): Promise<ProjectRuntime> {
    const project = this.projects().find((candidate) => candidate.board.hasGroup(groupId));
    if (!project) throw new NotFound('unknownGroup', 'unknown group');
    return project;
  }

  /** The project of this canvas. */
  async getProjectRuntimeForCanvas(canvasId: string): Promise<ProjectRuntime> {
    const project = this.projects().find((candidate) => candidate.board.hasCanvas(canvasId));
    if (!project) throw new NotFound('unknownCanvas', 'unknown canvas');
    return project;
  }

  /** The project of this chat (its id as a URL gives it), and the chat's number. */
  async getProjectRuntimeForChat(chatId: string): Promise<{ project: ProjectRuntime; chat: number }> {
    const chat = Number(chatId);
    const project = Number.isSafeInteger(chat) ? this.projectOfChat(chat) : undefined;
    if (!project) throw new NotFound('unknownChat', 'unknown chat');
    return { project, chat };
  }
}
