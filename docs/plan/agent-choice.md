# Choosing an agent for a task

## Goal

Let the owner choose the right agent when starting a task: a chevron beside “Start agent” offers model choices and, as the project grows, custom agents with their own instructions and guidance on when to use them. Keep starting with the existing default simple, and leave room for a later recommendation based on the task.

## Workstreams

- [x] **W1:** Choose a model at start. Add a discoverable chevron to the task's Start agent control, with the current worker default and the available harness, model and effort choices. Starting without a choice uses the existing default; a choice stays on the card until it starts and applies to that start without changing global settings. Show unavailable choices and errors clearly, and preserve the selected configuration across queues, restarts and replies using the existing session pinning. Cover desktop and phone, keyboard access, and the supported start paths; verify the selected model reaches the worker.
- [ ] **W2:** Define custom agents. Let the owner create, edit and remove named agent definitions with a specific prompt, harness, model, effort and a short hint describing suitable tasks. Persist them across restarts, validate choices and explain unavailable configurations. Establish how their instructions combine with Seismic's essential worker instructions, and keep existing sessions stable when a definition changes or is removed. Test persistence, validation and instruction delivery.
- [ ] **W3:** Start with a custom agent. Offer the saved agents and their use hints in the start menu alongside the default and model choices. Apply the chosen definition to the task, show the owner what was selected, and preserve a snapshot for the session through queuing, restart and continuation. Handle deleted or unavailable definitions without silently changing the choice; verify the full start and resume flow on desktop and phone.
- [ ] **W4:** Recommend an agent. Explore and implement an optional classifier that uses the task and agent hints to suggest a suitable available agent before start, with a clear reason and a way to choose another or use the default. Define when classification runs, its latency and cost, and what happens on failure or low confidence; never start an agent merely from a recommendation. Test recommendations, failures and owner overrides.

## Boundaries

A model, a harness and a custom agent are distinct: a custom agent adds instructions and a use hint to a runtime choice. W1 is useful before custom agents exist; W2 and W3 build the authoring and selection flow in sequence. W4 is a later, optional direction, subject to deciding whether its usefulness justifies its cost and complexity. Existing configured defaults and pinned sessions remain compatible throughout. Coordinate harness availability and parity with [Codex preview hardening, then Pi](codex-runtime.md). Future use of performance feedback in recommendations is planned in [Feedback on agent performance](model-feedback.md).
