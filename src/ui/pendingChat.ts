import type { Talk } from '../core/types';

/** Only the echo of this individual send settles its optimistic bubble. */
export const echoed = (requestId: string, talk: Pick<Talk, 'requestId'>[]) => talk.some((entry) => entry.requestId === requestId);
