# Always allow

A fork-only extension (see `docs/plan/extensions.md`). Its design lives here rather than in
`docs/design/`, so that it leaves with the extension; without it, a permission question offers only
"Allow" and "Deny" (design: Refused and confirmed tool calls).

Where a rule of the allow list could let a call the owner is asked about through from now on, a
third option between "Allow" and "Deny" names it ("Always allow: bun run *") and the
question says where it goes: it allows the call and adds the rule to the repository's allow list,
the `permissions.allow` of its `.claude/settings.json`, which Claude Code and Seismic's Codex workers
both go by (design: Native Codex workers). For Claude the rule is what Claude Code suggests for its
own "don't ask again", and the asking session takes it at once; for Codex it is Codex's proposed
command prefix, else the program and its subcommand followed by anything (`bun run *`), else the
command as it is, per program of a plain command (the shell's setup in front needs none), and none
where the command is not plain or asks for more than network.

Seismic commits the rule on the main branch itself, beside the checkout as "For everyone, into the repository"
does (refused where the checkout has changes of its own in the file; the call then runs
once and the conversation says why the rule did not go in), with `.codex/rules/obeya.rules` made
again where the repository has it made from the list; in a folder without git it goes into the
folder's files. The owner's click is their trust: a `claude` or `codex` group trusted before stays
trusted with the rule (design: Trusting a repository's commands), so Codex workers go by it at
once, and other Claude workers once their branch has the commit. A line in the conversation says
what was added. Where work lands through pull requests, nothing goes onto main by itself, so the
option is not offered there.

Decided 2026-11-03 (owner): one list for everyone, committed at once; rejected: the card's branch
(the rule would wait for the landing and be lost with a discarded card) and
`.claude/settings.local.json` on this machine (Codex has no per-project file of its own outside the
repository, and the cards' workspaces would not have it, so Seismic would have to apply it to both
harnesses itself).

## What it uses of the seam

- `permission.options` and `permission.picked`: the option on the question, and what picking it does.
- The question's request carries Claude Code's `suggestions`; an answer's `permissions` go to the
  asking session as its `updatedPermissions`.
- `asOwner`: the commit counts as the owner's change, so trusted configuration stays trusted.

Two generic changes of the same feature stay in the core, since they hold without it: reading
Claude Code's older `prefix:*` rules in the allow list, and a change under `.claude/` or `.codex/`
not restarting Seismic.
