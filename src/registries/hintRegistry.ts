export interface HintRegistryItem {
  id: string;
  description: string;
}

export const HINT_REGISTRY = [
  { id: 'canvases', description: 'The "+" tab of the canvas strip says "New canvas" until a canvas is made.' },
  { id: 'card-refs', description: 'Under the task field: typing "/" and words of a card title links that card, until a card is first linked.' },
  { id: 'cite', description: 'The cite button under a conversation says what it does until it is first used.' },
  { id: 'dep', description: 'The dependency handle on a card is labelled until a dependency is first drawn.' },
  { id: 'help-key', description: 'The help button is labelled until the help is first opened.' },
  { id: 'mark', description: 'The hint about marking several cards shows until cards are first marked.' },
  { id: 'marks', description: 'The hint about marking a screenshot shows until a screenshot is first marked.' },
  { id: 'move-marked', description: 'The hint that marked cards move together shows until a marked card is first moved.' },
  { id: 'needs-you', description: 'The Needs you button in the top bar carries its name until it is first clicked.' },
  { id: 'paste', description: 'The hint that screenshots can be pasted shows under the field until one is pasted.' },
  { id: 'review-pr', description: 'Alert hint under the chat about asking for a pull-request review, until a review card is made.' },
  { id: 'seek-keys', description: 'Over a demo video: the ← and → keys jump in it, shown after a click on the controls until the keys are first used.' },
  { id: 'skills', description: 'Under the task field: "/" asks the agent for one of its skills, until the skills menu is first used.' },
  { id: 'touch-hold', description: 'The hint about holding a card on a touch screen shows until a card is first held.' },
  { id: 'zoom-key', description: 'On hover over the magnifier on a demo video: the Z key zooms it, until the key is first used.' },
] as const satisfies readonly HintRegistryItem[];

export type HintId = (typeof HINT_REGISTRY)[number]['id'];

const ids = new Set<string>();
for (const { id } of HINT_REGISTRY) {
  if (ids.has(id)) throw new Error(`hint id "${id}" is registered twice`);
  ids.add(id);
}

/**
 * Whether `id` is a registered hint of `HINT_REGISTRY`, the list of every hint of the app. Each new
 * hint, an alert hint or the label on a button that is otherwise only an icon, is added there first
 * with a unique `id` and a `description` of what it says and where it shows: the components take
 * only an id from this list, and the server stores only these. The registry refuses a repeated id
 * when it loads. A hint stays listed after its feature is gone, and an id is never renamed or
 * reused, so a stored id never means something else.
 */
export function isHintId(id: string): id is HintId {
  return ids.has(id);
}
