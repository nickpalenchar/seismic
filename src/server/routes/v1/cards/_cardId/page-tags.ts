import { BadRequest } from '../../../../board';
import type { Item } from '../../../../../core/types';
import type { CardService } from '../../../../services/cardService';
import { HttpRoute, type RouteRequest } from '../../../httpRoute';

/** The owner sets the tags (`values`) of a shared demo page in one `dimension`. Answered with the card. */
export class PageTags extends HttpRoute {
  readonly path = '/api/v1/cards/:cardId/page-tags';

  constructor(private readonly cardService: CardService) {
    super();
  }

  override POST = async (request: RouteRequest): Promise<{ card: Item }> => {
    const body = await this.bodyOf(request);
    if (typeof body.dimension !== 'string' || !Array.isArray(body.values) || !body.values.every((v) => typeof v === 'string')) throw new BadRequest('invalid', 'dimension must be a string, values a list of strings');
    return { card: await this.cardService.performAction(request.params.cardId!, { action: 'pageTags', dimension: body.dimension, values: body.values as string[] }) };
  };
}
