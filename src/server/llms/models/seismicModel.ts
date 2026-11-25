




import { HARNESS_NAMES, type Harness, type ModelInfo, modelReadsImages } from '../../../core/types';


export const CAPABILITIES = ['images'] as const;
export type Capability = (typeof CAPABILITIES)[number];


export type CapabilityNeed = 'required' | 'optional';
export type Capabilities = Partial<Record<Capability, CapabilityNeed>>;

export class SeismicModel {
  constructor(
    readonly harness: Harness,
    readonly id: string,
    
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
