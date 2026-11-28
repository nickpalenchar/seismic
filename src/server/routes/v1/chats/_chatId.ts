import { BadRequest } from '../../../board';
import type { ChatModel } from '../../../../core/types';
import type { ProjectService } from '../../../services/projectService';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

const MODEL_PATTERN = /^(?:codex|agy):[A-Za-z0-9_.:/-]{1,200}$/;
const CLAUDE_MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku'];

/** A chat: the model its words are read with (`{ model }`, `null` for the project's default), answered with the chat's id and model. */
export class Chat extends HttpRoute {
  readonly path = '/api/v1/chats/:chatId';

  constructor(private readonly projectService: ProjectService) {
    super();
  }

  override PATCH = async (request: RouteRequest): Promise<{ chat: { id: number; model: ChatModel | null } }> => {
    const { project, chat } = await this.projectService.getProjectRuntimeForChat(request.params.chatId!);
    const { model } = await this.bodyOf(request);
    if (model !== null && model !== undefined && (typeof model !== 'string' || (!CLAUDE_MODELS.includes(model) && !MODEL_PATTERN.test(model)))) throw new BadRequest('invalid', 'unknown model');
    const chosen = model == null ? undefined : (model as ChatModel);
    project.board.setChatModel(chosen, chat);
    return { chat: { id: chat, model: chosen ?? null } };
  };
}
