import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** The cards (`{ cards }`) leave their groups. */
export class Ungroup extends HttpRoute {
  readonly path = '/api/v1/cards/ungroup';

  override POST = async (request: RouteRequest): Promise<void> => {
    const { cards } = await this.bodyOf(request);
    (await this.projectOfCards(cards)).board.group(cards, null);
  };
}
