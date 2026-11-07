// `to_seismic`: what the owner says or types on a card an agent listens on goes straight to that
// agent, and the agent passes on what asks Seismic for something rather than itself. One tool for
// workers (prototypes included) and exploration agents; the Koordinator reads the request with the
// owner's own words, as a command, and its confirmation or reply is the tool's result.

import { z } from 'zod';
import type { AgentTool } from './runtime';
import { messageOf } from '../core/text';

/** Passes `request` on from the agent's card; settles with what the Koordinator did or replied. */
export type Forward = (request: string) => Promise<string>;

/** What the agent's instructions say about it, in one paragraph. */
export const TO_OBEYA =
  "The owner's words on your card come to you, typed or spoken. Some ask Seismic rather than you: approve your work, stop you, start a card, a follow-up card, a rule to remember, grouping cards, an action on another card, a question about the canvas or another card, a wish or a bug for Seismic's makers. Pass those on with to_seismic: Seismic does them as the owner meant (a follow-up it creates and starts, where propose_card would only propose one), with a confirmation the owner can take back.";

export function toObeyaTool(forward: Forward): AgentTool {
  return {
    name: 'to_seismic',
    description:
      "Pass on to Seismic what the owner's words to you ask of Seismic rather than you (approve, stop, start, a follow-up or new card, remember a rule, grouping cards, an action on another card, a question about the canvas or another card, a wish or a bug for Seismic's makers). request: what they ask, in a sentence; Seismic reads it beside their own words. The result is what Seismic did or answered, which the owner sees too; actions wait a few seconds for the owner to undo them.",
    schema: { request: z.string() },
    run: async ({ request }) => {
      const r = String(request).trim();
      if (!r) return 'Nothing passed on: the request is empty.';
      try {
        return `Seismic: ${await forward(r)}`;
      } catch (e) {
        return `Seismic could not take it: ${messageOf(e)}`;
      }
    },
  };
}
