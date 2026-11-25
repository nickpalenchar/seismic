



export const whereRulesGo = `
A rule goes to one of two places:
- The preference memory, for rules at the level of Seismic: how the agents work with the owner through Seismic, whatever the repository. What to ask the owner and what to decide alone, how many options a question offers, how to report, hand over and demo, what to decide in the owner's name and what not. Leave repos out.
- A repository's CLAUDE.md, for anything about a repository: its conventions, product requirements, tools, how its code is written, tested and landed, the UI and its wording, and taste in code too, even when it holds in every repository. There it is versioned, colleagues see it, and Claude Code follows it outside Seismic as well. Pass repos: the repository it concerns (usually the card's), or every repository of the project when it holds in all of them. A worker writes it into the CLAUDE.md once the owner accepts it; until that has landed, no agent follows it. If the repository's CLAUDE.md or docs say it already (you can read them), propose nothing.
`.trim();


export const reposParam =
  "repos: the ids of the repositories whose CLAUDE.md the rule belongs in (one proposal each); leave it out for a rule on how agents work with the owner through Seismic.";

