/**
 * What a session needs of its model (`AgentNeeds`), judged from the model's catalog entry
 * (`ModelInfo`), whichever harness runs it. A harness hands in the entry of the model it resolved;
 * where its catalog does not say what the model reads, nothing is assumed and the images go through.
 */
import { type ModelInfo, modelReadsImages } from '../../../core/types';
import type { AgentNeeds } from '../agents/types';

/** What a session that only takes screenshots as a help reads where its model cannot see images. */
export const IMAGES_DROPPED = 'Screenshots came with this message, but the model you run on cannot read images, so they are left out. Go on from the text alone.';

/**
 * A message as the model can take it. Images its model cannot read are left out, with a note in the
 * text, where the session takes them as a help (`optional`); where it needs them (`required`) or
 * declared nothing, this throws: as before, a model that cannot read what it is sent is an error.
 */
export function messageForModel(
  needs: AgentNeeds | undefined,
  model: ModelInfo | undefined,
  message: { text: string; images: string[] },
  harness: string,
): { text: string; images: string[] } {
  if (!message.images.length || modelReadsImages(model) !== false) return message;
  if (needs?.images === 'optional') return { text: `${message.text}\n\n${IMAGES_DROPPED}`, images: [] };
  throw new Error(needs?.images === 'required' ? `The selected ${harness} model does not support images, which this session needs` : `Selected ${harness} model does not support images`);
}
