import type { Group } from '../../../core/types';
import { HttpRoute, type RouteRequest } from '../httpRoute';

/**
 * A new group with the cards in it (`{ name, cards, hue? }`; the project and canvas are the cards'),
 * answered with the group. A name a group has already puts the cards into that one.
 */
export class Groups extends HttpRoute {
  readonly path = '/api/v1/groups';

  override POST = async (request: RouteRequest): Promise<{ group: Group }> => {
    const { name, cards, hue } = await this.bodyOf(request);
    return { group: (await this.projectOfCards(cards)).board.createGroup(name, cards, hue) };
  };
}
