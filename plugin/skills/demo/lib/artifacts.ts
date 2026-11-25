





export const HANDOVER_ARTIFACTS = ['video', 'html', 'schema'] as const;
export type HandoverArtifact = (typeof HANDOVER_ARTIFACTS)[number];

/** A list of artifacts that leaves a handover a demo: it holds `video` or `html`. */
export const allowsDemo = (a: readonly HandoverArtifact[]) => a.includes('video') || a.includes('html');
