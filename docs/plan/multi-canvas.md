# Several canvases per project

## Goal

Let a project hold several canvases, switched like the sheet tabs of a spreadsheet. A small tab strip peeks out at the bottom right of the screen and shows only each canvas's icon or emoji; the selected canvas is an expanded dot with its name. Hovering over the strip (a tap on touch) slides out a drawer that lists the project's canvases by name, so switching is one click. A bold "+ Create" button joins the top-right group with the menu Card / Canvas / Project. A project starts with one canvas, "main".

To make room for the new word, the vocabulary changes in the UI and the data model alike:

| Name | What it is | Called today |
|---|---|---|
| **Workspace** (later, not built now) | The whole instance: the user's token, several users if that comes, all projects, the system configuration | – |
| **Project** | An app with its repositories, models, review configuration, demo site and its own Seismic | "project" in the UI; "canvas" in code and data |
| **Canvas** | New: a container of cards inside a project, at least one per project | – |
| **Plan** | A card backed by a plan doc, whose workstreams are its child cards | "project" (UI and card kind); renamed in W1 |
| **Workstation** | Where an agent works: a card's own git checkout | "workspace" |

Workstreams keep their name. The workspace level is only reserved as a word; nothing of it is built.

## Shape

**Shared per project:** repositories, settings, demo site, Seismic, the inbox count, the left project picker. **Per canvas:** cards, groups, layout, minimap, edge indicators.

**Tabs and drawer** sit at the bottom right, above the status bar. They show when a project has more than one canvas, plus a small "+". The drawer lists the canvases in order, each with its waiting count in orange, and ends with "+ New canvas". Rename, change icon and reorder sit behind hover. Delete is possible only for an empty canvas, never for "main".

**+ Create** sits top right, before the gear, and replaces the teaching-only "New task". Card creates and unfolds a card at the centre of the view; Canvas opens a dialog asking for a name and an icon; Project does what "New project" does today (a new project with its repositories).

**Icon picker:** a grid of common emojis plus a curated set of Lucide icons; the exact set is the worker's call. A canvas name may not be a number from 1 to 999.

**Addresses:** the canvas is a hash, not part of the path. `/p/<project>#main` names it, `/p/<project>#2` is the second canvas in the drawer's order (`#1` is the first). `/p/<project>` without a hash opens the first canvas. A card's address `/p/<project>/c/<code>` needs no hash, since every card knows its canvas; a hash naming another canvas is dropped. Switching canvas updates the hash.

**Cards across canvases:**

- A new card goes to the canvas you are on; "Move to canvas" sits in a card's overflow menu.
- Follow-ups, proposals and prototypes land on their parent's canvas.
- A plan lives with its workstreams on the canvas where it was created ("main" for those found in the repository).
- Dependencies may cross canvases and show a stub with the other canvas's icon.
- Search, the inbox and card links reach every canvas and switch to it.
- Seismic puts its cards on the canvas you are looking at.

**Phone:** no tabs. It keeps one list across the project, each card marked with its canvas's icon. Tablets get the tabs.

## Workstreams

- [x] **W1:** Rename plan cards. Today's plan-backed "project" cards become **plans** everywhere: code, card kind, UI strings (English and German), stage files, agents' prompts and tools, the plugin's skills, and the docs. Behaviour does not change. Must land before W3, so that no word means two things at once. Plan docs in `docs/plan/` stay where they are.
- [ ] **W2:** Rename workspaces to workstations. The table `workspaces`, the code, UI strings, prompts, the plugin's skills and the docs (including the chapter "Agents and workspaces" and its file name) say **workstation** for a card's git checkout. The data is migrated in place. No behaviour change. Lands after W1 and before W3.
- [ ] **W3:** Rename canvases to projects. Everything called "canvas" today (about 5,500 mentions in 174 files: table `canvases` and `canvas_id`, `canvases.json` → `projects.json` read once from the old file and then written as the new one, data exports, scratch stage files, API routes, agents' MCP tools and prompts, the plugin's skills, `design.md` concepts, chapters, CLAUDE.md, and file names that carry the old word) becomes **project**. The database is migrated in place; the rule "fields named `canvas` keep their format" goes. The risk is a missed spot when migrating a live `~/.obeya`: test the migration on a copy of a real home directory, starting an older Seismic's data with the new code. Frees the word "canvas" for W4.
- [ ] **W4:** Canvas layer in the data model. A new table of canvases (project, name, icon, order); cards and groups belong to a canvas. The migration gives every project a canvas "main" holding all its existing cards and groups. Names are unique per project and may not be a number from 1 to 999; "main" cannot be deleted or renamed away, and only an empty canvas can be deleted. API and agents' tools gain create, rename, icon, reorder, delete and move-card-to-canvas; new cards, follow-ups, proposals, prototypes and plans with their workstreams land on the right canvas (a parent's, or the one Seismic is looking at). Layout, minimap and edge indicators are per canvas, repositories, settings, demo site and the inbox count stay per project. Test the migration on a copy of a real home directory.
- [ ] **W5:** Tabs, drawer and canvas addresses. The bottom-right tab strip and drawer with waiting counts, switching in one click, hover for rename, icon change and reorder, and the "+ New canvas" entry; the dialog with name and icon picker (emojis plus curated Lucide icons) with the name rule; the hash addresses (`#main`, `#2`, none = first canvas, a card link opens its own canvas and drops a foreign hash). Search, the inbox and card links reach every canvas and switch to it; a card's overflow menu offers "Move to canvas"; dependencies across canvases show a stub with the other canvas's icon. Strings in English and German; the drawer and strip are discoverable on first use and unsaved input survives switching canvas.
- [ ] **W6:** "+ Create" menu and phone. The bold "+ Create" button before the gear with Card / Canvas / Project replaces the teaching-only "New task"; Card creates and unfolds a card at the centre of the view, Canvas opens the W5 dialog, Project does what "New project" does today. On the phone there are no tabs: one list across the project, each card marked with its canvas's icon; tablets get the tabs. Move the final description into the design chapters and delete this plan doc.

## Boundaries

W1 to W3 are one rename in a fixed order and change no behaviour; they can be started right away and each lands on its own. W4 to W6 are the feature and follow in order. The vocabulary is a decision already taken: workspace (later) → project → canvas, plans for plan-backed cards (called "project" before W1), workstations for the places agents work. Dropped alternatives: a new switcher for today's projects (it gives no second surface inside a project) and the canvas in the address path (it goes in the hash).
