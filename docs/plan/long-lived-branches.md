# Long-lived branches with their own canvases

## Goal

Let a project run long-lived branches beside its default branch. Each branch is a channel of its
own with its own canvases: cards on it start from that branch and land on it. It stays in step with
its base branch as its sync option says, and is finally merged back into its base and closed. The
feature is switched on per project. A new **Branches** view shows the branches as columns of
commits, and a branch switcher sits next to the project switcher.

## Today

- Every repository has one main branch: the one the owner set on this machine, else the detected
  one (origin's HEAD, the only non-card branch, `main`/`master`); see `defaultBranch` in
  `src/server/workstations.ts`. Every card starts from it and lands on it.
- How work lands is set in `.seismic/settings.json` (`land: main | pr`, `direct`, `autoMerge`),
  always read from the main branch. A card can override `land`/`direct` for itself (`CardLanding`
  in `src/core/types.ts`).
- Card branches are `seismic/<title>-<id>`. A card's change is already measured from the nearest
  branch that is not a card branch, so a long-lived branch works as a base there unchanged.
- Canvases (cards, groups, layout) belong to a project; repositories, settings and the inbox are
  per project. The view switcher at the bottom centre is Canvas | Parked | Table; Queue and Archive
  are in the left menu.
- Landing safety rules: nothing is force-pushed, a direct push only fast-forwards, a merge is
  pinned to the head that was checked. The landing queue is `landing-queue.ts` and `merges.ts`.

## Vocabulary

| Name | What it is |
|---|---|
| **Default branch** | The branch Seismic uses as main today (`defaultBranch`); starred in the Branches view |
| **Long-lived branch** | A branch the owner created in Seismic, with a base, a landing option and a sync mode |
| **Base** | The branch a long-lived branch was cut from and syncs with: the default branch or another long-lived branch |
| **Down sync** | Base → branch: the base is merged into the branch |
| **Up landing** | Branch → base: a card that landed on the branch lands on the base too |

## Shape

**Switching it on.** A project setting "Long-lived branches", off by default. Once on, a git button
sits top right next to the project preferences and opens the Branches view; Branches also goes after
Table in the view switcher and into the left menu. Without the setting, nothing of this shows and a
project behaves as today.

**Where a branch's configuration lives.** In Seismic's project data, not in
`.seismic/settings.json`, which is only ever read from the default branch. The rest of the
repository's settings (checks, setup, demo) apply on the branch unchanged. A branch keeps: name,
base, the commit it was cut from per repository, its landing option (lands on the branch | goes out
as a pull request) and its sync mode.

**Across repositories.** A branch covers all of the project's repositories and is created and pushed
in each at creation. In the repository whose commits the dialog lists (the first; a select of
repositories appears only where there are several) it is cut at the chosen commit, in the others at
the base's head. With several repositories, a column interleaves their commits by time, each marked
with its repository's name. A repository without a remote keeps the branch local.

**Branches view** (the owner's wireframe, tighter spacing than the sketch):

- One column per branch, side by side, the default branch first.
- Each branch's name in monospace as a tab on the column's top edge. The default branch carries a ☆
  and the tooltip "Default branch". Under a long-lived branch's tab: its base and sync mode
  ("↳ from main · ⇅").
- Commits hang on a vertical line, one dot each, newest first, the short hash in muted monospace
  above. A commit Seismic made shows as its card, in the canvas's card look, compact, and opens the
  card on click. Any other commit is a grey monospace box with its title and the start of its body.
- Each column shows the last 6 commits; **Load more** at the end of the line adds 6.
- After the last branch, a dashed placeholder column "New Branch" with a large ⊕ opens the dialog
  with the default branch as base, cut from its head.
- Hovering a commit shows a ⊕ at its edge: the dialog with that branch as base and that commit as
  the cut point.
- Hovering a long-lived branch's tab shows **Pull base in**, **Merge into base** (the branch stays)
  and **Merge and close**, and the way to change its options.

**"New Long Lived Branch" dialog** (the owner's wireframe):

- Title, and "Create a branch that will carry multiple features and sync with another long-lived
  branch", with **Learn more** to the branches page of the user docs.
- **Branch name**; **Base branch** (the default or another long-lived branch); **Cut from**: a
  select of the base's recent commits ("affee2 Commit title"), its head preselected.
- **Approved work**: a two-part toggle, "Lands on the <name> branch" | "Goes out as a pull request".
- **Auto syncing options**: four radio tiles, **Two-way** ⇅ (default), **Base only** ↑, **Branch
  only** ↓, **Manual** ⊟. Under them a line spelling out the choice in the branch names, e.g.
  "Commits on main auto-merge into release-1. Commits on release-1 auto-merge into main."
- A summary line: "The branch release-1 will be cut from affee2 and will be pushed to GitHub upon
  creation", or that it stays local for a repository without a remote.
- **Create branch**, with a spinner while git runs. Creating a branch switches to it.
- Every option except the name and the cut point can be changed later from the branch's tab.

**Branch switcher.** A second switcher right of the project switcher: git icon and branch name. Each
branch has its own canvases, starting with an empty "main"; the tab strip shows that branch's
canvases. Search, the inbox and card links reach across branches and switch to them.

**Merge and close.** A confirmation: "This commits back into <base> one final time, then deletes
the branch." The merge goes the way the base's own landing goes; then the branch is deleted locally
and on origin. If cards are still open on the branch, the dialog asks where they go: to the base's
canvases, parked, or deleted; cards that move get their start point moved to the base. A branch that
other branches are based on closes only after them, or its children are re-based onto its own base;
a child branch is never left without a base.

## Git rules

- **Down sync:** when the base moves, Seismic merges the base into the branch (modes Two-way and
  Branch only).
- **Up landing:** each card that lands on the branch lands on the base as well, with the same
  commits, as a merge of its card branch, never a cherry-pick (modes Two-way and Base only). It goes
  the way the base's own landing goes: the default branch's `land` setting, or a long-lived base's
  Approved work option.
- **No ping-pong:** only card landings and manual merges go up. Down-sync merges never trigger an up
  landing, so Two-way cannot loop.
- **Labels:** "Base only" (↑) means only the base receives automatically, "Branch only" (↓) only the
  branch. The line under the tiles makes this explicit in the branch names.
- **Order:** the branch first, then the base. The up landing is a step of its own that can
  conflict; its conflicts are resolved the way a card's are today (the card resolves them, or the
  work goes as a PR). The card counts as done only when both landings are in.
- **Sync conflicts:** a conflict in a down sync does not block the branch. It becomes a card on the
  branch that resolves it.
- **Safety:** branches move only by fast-forward or by a merge Seismic checked, pinned to the head
  it checked; nothing is force-pushed.
- **Manual merges:** "Pull base in" and "Merge into base" run through the same landing path, with
  undo and its checks.
- **Pushing:** pushing the new branch to origin is part of creating it; the owner's click on Create
  branch is the consent.
- **Matching commits to cards:** by the card's merge commit or its trailers, never by guessing from
  the commit message.

## Workstreams

- [ ] **W1:** Branch entity, cutting and landing. The project setting "Long-lived branches" (off by default, with its entry in "Project defaults"). A table of branches in the project data: name, base (the default branch or another long-lived branch, nested bases included), cut commit per repository, landing option, sync mode; migrated in place, tested on a copy of a real home directory. Creating a branch cuts it in every repository of the project (the chosen commit in the first, the base's head in the others) and pushes it to origin where there is one, failing as a whole with nothing left half-made. A card belongs to a branch: its workstation starts from that branch, its change is measured from it, and it lands on it with the branch's landing option in place of main's `land` (a card's own `CardLanding` still overrides). `defaultBranch` stays the default branch for everything without a branch. API and agents' tools to create a branch, change its options, and list a branch's commits with their cards (matched by merge or trailers), paged by 6, across repositories by time. Land this data model first: W3 and W4 build on it.
- [ ] **W2:** Sync modes and manual merges. Down sync when the base moves (Two-way, Branch only) as a checked merge through the landing queue; a conflict becomes a card on the branch that resolves it and blocks nothing else. Up landing of each card that landed on the branch (Two-way, Base only): the same card branch merged into the base the way the base lands (main's `land`, or the base branch's option), as a step of its own after the branch landing, with its own conflict path; the card is done only when both are in. Down-sync merges never go up. "Pull base in" and "Merge into base" through the same path with undo and checks. Tests against the fake runtime and real git repositories for each mode, nested bases, a conflict in each direction, and that Two-way never loops.
- [ ] **W3:** Canvases per branch, switcher and addresses. Canvases belong to a branch (the default branch's are today's); a new branch starts with an empty "main"; the tab strip shows the current branch's canvases. The branch switcher right of the project switcher (git icon, branch name), shown only with the setting on. The branch goes into the address in a way that keeps today's addresses working and remembers the branch last chosen per project, as the canvas is remembered; a card's address opens its own branch and canvas. Search, the inbox and card links reach across branches and switch to them; new cards, follow-ups, proposals and plans land on their parent's branch, Seismic's on the branch the owner is looking at. Phone: the branch shows in the one list per project. Can start once W1's data model has landed.
- [ ] **W4:** Branches view and "New Long Lived Branch" dialog. As wireframed above, compact: columns with monospace name tabs, the starred default branch with the "Default branch" tooltip, base and sync mode under a long-lived branch's tab, the commit line with Seismic's commits as compact cards that open on click and other commits as grey boxes, 6 commits with Load more, the dashed "New Branch" column, ⊕ on a commit, the tab's hover actions and the options editor. The dialog with name, base, cut-from select, the repository select where there are several, Approved work, the four sync tiles with the line spelling them out, the summary line, Create branch with a spinner, then switching to the new branch. The git button top right, Branches after Table in the view switcher and in the left menu, all only with the setting on. Strings in `src/ui/strings.ts`; follows `docs/design/ui-system.md` (keyboard paths, phone view, discoverability). Can start once W1's data model has landed; the merge actions go live with W2.
- [ ] **W5:** Merge and close. The confirmation "This commits back into <base> one final time, then deletes the branch."; the final merge the way the base lands; deleting the branch locally and on origin in every repository. Open cards go, as the owner chooses, to the base's canvases (start point moved to the base), parked, or deleted. A branch with child branches closes only after them, or re-bases them onto its own base; a child is never left without a base. The branch's canvases go with it; what happens to canvases that still hold landed cards is the worker's call, recorded in the design chapter.
- [ ] **W6:** Docs. A design chapter `docs/design/branches.md` (listed under Chapters in `docs/design.md`) with the lasting decisions and constraints: configuration in project data, the git rules, no ping-pong, matching commits to cards. The user docs page on branches in `docs/site/` that Learn more points to, and the settings reference for the new project setting. Then delete this plan doc.

## Boundaries

W1 carries most of the risk and lands first, its data model before the rest of it; W3 and W4 can
run alongside W1 and W2 once that model is on main. W5 follows W2, W6 comes last. Decisions already
taken: keeping in step is a sync option per branch (Two-way / Base only / Branch only / Manual), with
manual merges either way always possible; no tag field; the dialog and the Branches view follow the
owner's wireframes, more compact; a branch's configuration lives in Seismic's project data; a branch
covers every repository of the project and is pushed on creation. Dropped: lazy creation per
repository (pushing on creation needs it up front), cherry-picking cards up to the base (a merge of
the card branch keeps the same commits), and guessing a commit's card from its message.
