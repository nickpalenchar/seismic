# Feedback on agent performance

## Goal

Let the owner optionally give feedback on an agent's performance after approving a card, and retain it as metadata attributed to the harness, model and effort that did the work. Connect each response to its plan (when it has one) and card so it can later inform comparisons and recommendations, without making approval depend on a rating.

## Workstreams

- [ ] **W1:** Attribute and retain feedback. Store each response as local metadata with a stable card link, plan context when present, and the actual session's harness, resolved model and effort, rather than current defaults. Define how to represent missing attribution and cards worked on by more than one configuration without crediting the wrong model; retain historical attribution when settings or sessions change. Keep the schema extensible for future task complexity and type, without requiring either now. Test migrations, standalone and plan cards, missing data, restarts and duplicate submissions.
- [ ] **W2:** Capture optional feedback. Add an enable/disable setting in Configuration and a discoverable, skippable feedback prompt after approval; disabling it stops prompts without deleting existing responses. Decide the rating scale and whether a short comment is useful with the owner before implementing the interaction. Preserve approval and landing when feedback is skipped or saving fails, allow the owner to return to an unanswered prompt, and cover desktop and phone, restarts, repeated approval events and unchanged-work cards. Test enabled and disabled flows and persistence.
- [ ] **W3:** Explore and build a performance dashboard. With the owner, decide which comparisons and visualizations are useful, then provide a dashboard of recorded feedback grouped by harness, model and effort, with plan and card context and links back to the evidence. Show sample counts and missing attribution, and handle empty and small datasets without implying a reliable ranking. Verify filtering, aggregation, navigation and accessibility on supported views.

## Boundaries

Feedback measures the owner's assessment of the work, not an objective model benchmark; task difficulty, type and other contributors may affect it. Complexity and task classification are future dimensions, not required fields or new card kinds in this project. A later recommendation may use accumulated feedback, but this plan does not change model selection or automatically recommend a model. Coordinate that future use with [Choosing an agent for a task](agent-choice.md).
