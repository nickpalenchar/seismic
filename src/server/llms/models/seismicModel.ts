/**
 * A model as a session runs on it: which harness, which model, and what that harness's catalog says
 * of it (`ModelInfo`). A harness builds one for the model it resolved; what a model can do is asked of
 * it here, not worked out by whoever needs to know.
 */
import { HARNESS_NAMES, type Harness, type ModelInfo, modelReadsImages } from '../../../core/types';

/** What a session may need of its model. Only what some model really lacks is named, as a job or agent meets it. */
export const CAPABILITIES = ['images'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** `required`: the session cannot run without it. `optional`: it goes on without, and is told. */
export type CapabilityNeed = 'required' | 'optional';
export type Capabilities = Partial<Record<Capability, CapabilityNeed>>;

export class SeismicModel {
  constructor(
    readonly harness: Harness,
    readonly id: string,
    /** The catalog's entry for the model; none where the harness has no catalog. */
    readonly info?: ModelInfo,
  ) {}

  /** The harness as the owner knows it ("Codex"). */
  get harnessName(): string {
    return HARNESS_NAMES[this.harness];
  }

  /** Whether the model has the capability; undefined where its catalog does not say, which is not a no. */
  hasCapability(capability: Capability): boolean | undefined {
    return capability === 'images' ? modelReadsImages(this.info) : undefined;
  }
}
