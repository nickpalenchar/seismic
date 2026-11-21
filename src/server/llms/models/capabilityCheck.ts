/**
 * What a session asks of its model, set against the model: made by the agent that runs it
 * (`SeismicAgent.checkCapabilities`) once the harness has resolved the model, before the session's
 * first turn.
 */
import { type Capabilities, type Capability, CAPABILITIES, type SeismicModel } from './seismicModel';

/** What a session that only takes screenshots as a help reads where its model cannot see images. */
export const IMAGES_DROPPED = 'Screenshots came with this message, but the model you run on cannot read images, so they are left out. Go on from the text alone.';

const WORDS: Record<Capability, string> = { images: 'images' };

/** What is asked of the model by the agent and the job together: where both name a capability, the stricter stands. */
export function mergeCapabilities(...all: Capabilities[]): Capabilities {
  const merged: Capabilities = {};
  for (const needed of all) {
    for (const c of CAPABILITIES) {
      if (needed[c] === 'required' || (needed[c] === 'optional' && !merged[c])) merged[c] = needed[c]!;
    }
  }
  return merged;
}

export class CapabilityCheck {
  constructor(
    readonly model: SeismicModel,
    readonly needed: Capabilities = {},
  ) {}

  /** The required capabilities the model lacks. */
  get missing(): Capability[] {
    return CAPABILITIES.filter((c) => this.needed[c] === 'required' && this.model.has(c) === false);
  }

  /** The optional capabilities the model lacks: the session goes on without them. */
  get degraded(): Capability[] {
    return CAPABILITIES.filter((c) => this.needed[c] === 'optional' && this.model.has(c) === false);
  }

  /** Whether the session may run on the model. */
  get ok(): boolean {
    return !this.missing.length;
  }

  /** Why it may not, for the error it ends with. */
  get problem(): string | undefined {
    return this.ok ? undefined : `The selected ${this.model.harnessName} model does not support ${this.missing.map((c) => WORDS[c]).join(', ')}, which this session needs`;
  }

  /**
   * A message as the model can take it: images it cannot read are left out, with a note in the text,
   * where the session takes them as a help; where it needs them, or named nothing, it is an error, as
   * a model that cannot read what it is sent has always been.
   */
  apply(message: { text: string; images: string[] }): { text: string; images: string[] } {
    if (!message.images.length || this.model.has('images') !== false) return message;
    if (this.needed.images === 'optional') return { text: `${message.text}\n\n${IMAGES_DROPPED}`, images: [] };
    throw new Error(`Selected ${this.model.harnessName} model does not support images`);
  }
}
