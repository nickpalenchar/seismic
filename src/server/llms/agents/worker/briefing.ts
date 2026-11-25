




import { hostName } from '../../../hosts';
import { contributionOf, type StoredContribution } from '../../../board';
import { dimensions } from '../../../../core/page-tags';
import { basename } from 'node:path';
import type { Item, Mock } from '../../../../core/types';
import { decisionLog } from '../../../advisor';
import type { Shipped } from '../../../board';
import { CAPTURED_CHANGES } from '../../../workstations';
import type { WorkerSupervisor } from '../../../workerSupervisor/workerSupervisor';


export type BriefingHost = Pick<WorkerSupervisor, 'artifacts' | 'captured' | 'demoSkill' | 'demosDir' | 'detailOf' | 'folder' | 'o' | 'prSource' | 'proposalBoards' | 'shares' | 'taskImages'>;

/**
 * `headProblem`: on a review card's start, why its workstation is not on the PR's head (null where
 * it is), so the worker fetches it itself.
 */
export function workerBriefing(self: BriefingHost, card: Item, branch: string, resumed = false, headProblem?: string | null): string {
  const parts = [`Your card: “${card.title}”.`];
  const contribution = contributionOf(self.o.board.row(card.id));
  if (contribution) return reviewBriefing(self, card, contribution, branch, resumed, headProblem);
  const idea = card.idea?.prototypeOf ? self.o.board.card(card.idea.prototypeOf) : undefined;
  if (card.idea?.prototypeOf)
    parts.push(
      [
        `This card is a throwaway prototype for the idea “${idea?.title ?? ''}”, so the owner can see the idea before deciding on it; other prototypes may try other approaches beside it. It never lands itself: the owner either discards it (its code is thrown away, its demo stays in the archive) or has the idea built on its branch, by a worker who takes over what carries and brings it to production quality.`,
        'So build only what the demo needs to show, as quickly as you can: no tests, no polish, no docs or plan changes, and do not run the checks. Commit it on your branch anyway, so the demo can be reproduced and the idea can be built on it. The demo only needs to make the idea visible: a video of 30–60 s, or an HTML artifact when the idea is something to look at (drafts of a logo, say).',
        "Your questions and the owner's answers also reach the idea's exploration agent, so ask on this card; the idea will not ask them again.",
        idea?.idea?.discussion?.brief ? `The idea as discussed so far:

${idea.idea.discussion.brief}` : '',
        mocksText(idea?.idea?.discussion?.mocks),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  if (card.body.trim()) parts.push(card.body.trim());
  const captured = self.captured(card.id);
  if (captured)
    parts.push(
      `The working changes this card finishes are captured as a complete binary patch (${captured.length} characters) in your workstation's git directory, outside the files git tracks. Apply it first: \`git apply --binary "$(git rev-parse --git-path ${CAPTURED_CHANGES})"\`.`,
    );
  
  if (card.idea?.mocks?.length) parts.push(mocksText(card.idea.mocks));
  if (card.idea?.builtOn) parts.push(builtOnPrototype(self, card.idea.builtOn, !!card.parent));
  
  const fromBoard = card.from && !card.idea?.prototypeOf ? self.proposalBoards().find((b) => b.item(card.from!) ?? b.archived().some((i) => i.id === card.from)) : undefined;
  const from = fromBoard ? fromBoard.item(card.from!) ?? fromBoard.archived().find((i) => i.id === card.from) : undefined;
  if (fromBoard && from) {
    const summary = fromBoard.summary(from.id)?.trim();
    const there = fromBoard === self.o.board ? '' : ` on the project “${fromBoard.project.name}”`;
    parts.push(`This card follows up on the card “${from.title}”${there}.${summary ? ` Its worker handed it over with this summary:\n\n${summary}` : ''}`);
  }
  const shots = self.taskImages(card);
  if (shots.length)
    parts.push(`${shots.length === 1 ? 'The owner attached a screenshot' : `The owner attached ${shots.length} screenshots`} to the card (shown with this message; files: ${shots.join(', ')}).`);
  const plan = card.parent ? self.o.board.item(card.parent) : undefined;
  if (plan?.plan?.file) parts.push(`This is workstream ${card.plan?.label ?? ''} of the plan “${plan.title}”. Read its plan doc ${plan.plan.file} first; it holds the context and decisions.`);
  const decisions = plan ? self.o.board.decisions(plan.id) : [];
  if (decisions.length) parts.push(`Decisions taken in this plan so far:\n${decisionLog(decisions)}`);
  
  const part = plan?.plan?.file && from && fromBoard === self.o.board ? self.o.board.row(from.id).shipped : null;
  if (part) {
    const s = JSON.parse(part) as Shipped;
    const what = [s.pr && `pull request #${s.pr.number} (${s.pr.url})`, s.commit && `commit ${s.commit.slice(0, 7)}`].filter(Boolean).join(', ');
    parts.push(
      `A part of this workstream has landed already${what ? ` (${what})` : ''}, but the plan doc keeps the workstream open. Look at what landed and do the rest.`,
    );
  }
  if (self.folder) return folderBriefing(self, card.id, parts, resumed);
  parts.push(
    card.idea?.builtOn
      ? `You are on branch ${branch}, which holds the prototype's commits (and any earlier work on this card): look at its log and diff first.`
      : resumed
        ? `You are on branch ${branch}, which already holds earlier work on this card, perhaps uncommitted: look at its log, \`git status\` and diff first and go on from there.`
        : `You are on branch ${branch}, fresh from the default branch.`,
  );
  if (self.detailOf(card.id).conflict === true)
    parts.push(
      `The owner approved this work, but it could not land on main: rebasing the branch onto main conflicted, and the rebase may still be under way in your workstation (\`git status\`). Finish it: resolve the conflicts so that main's changes and yours both hold (git rebase --continue), or start the rebase again (git rebase --abort, then git rebase main). Then run the checks and hand over again: the approval holds, and Seismic lands the work without asking the owner again, with the demo already on the card.`,
    );
  if (self.o.adapter.setup) parts.push(`First run \`${self.o.adapter.setup}\` in the clone.`);
  const isNew = !!self.o.board.row(card.id).idea?.newRepo?.made;
  if (isNew)
    parts.push(
      `This repository is new: Seismic created it for this card with a first commit of what its folder held (a default .gitignore, else nothing). It is local only, with no remote. Besides the task, set it up as part of your work: a CLAUDE.md with what the task says about how to work in this repository, and its Seismic settings (\`.seismic/settings.json\`) with the skill \`seismic:settings\`, as the card “${self.o.board.t.adapterSetup.title(basename(self.o.repoPath ?? ''))}” would.`,
    );
  if (isNew || self.o.board.isSetupCard(card)) {
    const harnesses = self.o.harnesses?.() ?? ['Claude Code'];
    parts.push(
      `The agent harnesses that can work on this machine, for the allow list the skill \`seismic:settings\` drafts: ${harnesses.join(', ')}.${harnesses.length > 1 ? ' Ask the owner which of them to set it up for, with each one as an option, in the question the skill has you ask, except those the repository already has configured.' : ''}`,
    );
  }
  const allowed = self.artifacts();
  const { run, stop } = self.o.adapter.app ?? {};
  const parking = stop ? ' While the card waits for the owner, Seismic stops the app in your workstation; your next message then says so.' : '';
  const far = hostName(self.o.board.row(card.id).workstation) ? " (this workstation is on another machine: Seismic forwards that address's port, and only that one, to the owner's)" : '';
  const tryIt = ` Once it runs and opens in a browser, give its address with app_running, so the owner can try it by hand from the card${far}.`;
  if (run?.trim()) parts.push(`How to run the app: ${run.trim()}${parking}${tryIt}`);
  else parts.push(`${parking}${tryIt}`.trim());
  if (self.o.adapter.checks?.length && !card.idea?.prototypeOf) parts.push(`Before ready_for_review, run: ${self.o.adapter.checks.map((c) => `\`${c}\``).join(', ')}.`);
  parts.push(
    [
      `Then show the owner the result with a demo, so they can judge at a glance whether the work is done, and hand it over with ready_for_review.`,
      ...(allowed.includes('video')
        ? [
            `${allowed.includes('html') ? 'Usually that is a video' : 'That is a video'} of the change, recorded with ${self.demoSkill(card.id)} as its instructions say (directory, chapter titles). Its length follows the size of the change, never padded: 30–60 s for a small one (a fix: the broken behaviour, then the fixed one), 1½–3 min for a larger one. Skip the skill's last steps (opening the page, the notification, the chat reply): Seismic shows the demo on the card.${self.shares ? ` The owner may share the demo, a video or an HTML artifact, with colleagues of the team on a page of its own: hand it over with that page (title, text${dimensions(self.o.vocabulary?.()).length ? ', tags' : ''}), written for them.` : ''} ${run?.trim() ? 'Run the app for it as the recipe above says.' : "The repository's settings say nothing yet about how to run the app: find it out from the repository (README, scripts, configuration) and say in your summary how you ran it."}`,
          ]
        : [`This repository's settings allow no video as a demo: make an HTML artifact${self.shares ? ', and hand it over with the page (title, text) the owner may share with colleagues of the team, written for them' : ''}. ${run?.trim() ? 'Run the app as the recipe above says, where the artifact shows it.' : "The repository's settings say nothing yet about how to run the app: find it out from the repository (README, scripts, configuration) and say in your summary how you ran it."}`]),
      ...(allowed.includes('html')
        ? [
            `${allowed.includes('video') ? 'When the result is something to look at rather than something that happens (drafts of a logo or a layout side by side, a comparison of variants, an analysis, an answer), make an HTML artifact instead' : 'The artifact is a page to look at (screenshots of the change among them), also for drafts, comparisons, an analysis or an answer'}: an index.html in a new directory under ${self.demosDir(card.id)} (never in git), self-contained or with the files it loads beside it, made for the owner to decide on, and hand it over with kind 'html' (drafts the owner is to choose from before you go on come with ask's demo instead). It shows in a sandboxed frame on the card, about 800 px wide, without Seismic's API.`,
          ]
        : []),
      ...(allowed.includes('video') && allowed.includes('html') ? ['Where either would do, record the video: watching the work happen is what the owner enjoys most.'] : []),
      "Where the work itself is a file for the owner (a document, a report, a spreadsheet in the repository), name it in ready_for_review's files: the card shows it beside the demo.",
      ...(allowed.includes('schema')
        ? [
            `Where your change alters the data the app persists (tables, columns, indexes, relations, migrations, ORM models; not API types or config schemas), the owner also gets a schema-change page beside the demo, a video or an HTML artifact alike: render it as ${self.demoSkill(card.id)}'s section "A change to persisted data models" says, and name it first in ready_for_review's files, with data_models 'changed'.`,
          ]
        : []),
    ].join(' '),
  );
  return parts.join('\n\n');
}

/**
 * A review card's briefing: the contributor's pull request, the fixed order of the review (the
 * diff read for anything that reaches beyond the repository before any of it runs), the handover
 * with its results, and where the owner's change requests go.
 */
function reviewBriefing(self: BriefingHost, card: Item, c: StoredContribution, branch: string, resumed: boolean, headProblem?: string | null): string {
  const source = self.prSource(c);
  const ref = `refs/pull/${c.number}/head`;
  const { run } = self.o.adapter.app ?? {};
  const checks = self.o.adapter.checks ?? [];
  const parts = [
    `Your card: “${card.title}”.`,
    `This card reviews pull request #${c.number} by ${c.author}, who is not the owner: “${c.title}” (${c.url}). The owner asked for the review; once they approve your handover, Seismic merges exactly the head you reviewed. You never merge it yourself.`,
    card.body.trim() ? `What the owner said with it, on top of the review below:\n\n${card.body.trim()}` : '',
    headProblem
      ? `Seismic could not put your workstation on the PR's head (${headProblem}). Fetch ${ref} from ${source} into your branch ${branch} yourself (git fetch, then git checkout -B ${branch} FETCH_HEAD).`
      : resumed && headProblem === undefined
        ? `You are on branch ${branch}, which holds the PR's head as you reviewed it before. Fetch ${ref} from ${source} to see whether it moved.`
        : `Your workstation is on branch ${branch}, at the PR's head (${ref}, fetched from ${source}).`,
    [
      'The code is a stranger’s, and whatever of it runs, runs on the owner’s machine. So work in this order:',
      '1. Before you run anything of it (an install, the tests, the app, a script), read its diff against the merge base with the default branch. Look for network access, install and postinstall scripts, new dependencies, changed test and build scripts and their configuration, and access to files outside the repository. Where something looks suspicious, run nothing and ask the owner, saying what you found and where.',
      '2. Review the code the way this repository reviews code (its CLAUDE.md and docs; a second reviewer where they name one): correctness, security, quality, and whether the change fits the design docs.',
      `3. Show the change in a demo of before (the merge base) and after (the PR's head)${run?.trim() ? `, running the app as this recipe says: ${run.trim()}` : ', running the app as the repository does it (README, scripts)'}. Give the app's address with app_running once it runs, so the owner can try it by hand from the card.`,
      `4. Run ${checks.length ? `the checks (${checks.map((x) => `\`${x}\``).join(', ')})` : 'the repository’s checks'} on the PR's head, and a merge probe against the current default branch: whether the PR merges without conflicts (fetch the default branch, merge it without committing, then abort).`,
    ].join('\n'),
    [
      `Record your findings with findings (an empty list where the review found nothing), most severe first: the card shows them beside the demo, and the owner decides on each there. Then hand over with ready_for_review: the demo, recorded with ${self.demoSkill(card.id)} as its instructions say (skip its last steps: Seismic shows the demo on the card), and review: each check with whether it passed, and whether the PR merges without conflicts. The summary says what the owner needs to know beyond the findings.${self.shares ? " The demo's page is for colleagues: it shows what the PR changes for the user, not your findings." : ''}`,
      'Your findings are for the owner: nothing of them goes to the contributor unless the owner sends it. Keep the list current as the review goes on, from the owner\'s words (“finding 2 does not matter”) as from a push.',
    ].join(' '),
    [
      'The owner decides on each finding on the card, and their decision comes with their next message:',
      `- To ${c.author}: write the findings as one review of the PR asking for changes (request_changes, with their numbers), in the PR's language, as the owner's words to them (Seismic posts it with the owner's account), without mentioning Seismic or agents. Then end your turn: the card waits for ${c.author}, and Seismic passes you their answers and pushes; review a new head as above, update the findings (resolved where a push fixed one) and hand over again.`,
      c.canModify
        ? `- Yourself (${c.author} allows maintainers' edits): make the change and commit it on your branch, run the checks, mark the finding fixed, and hand over again with a new demo and pr_draft, the text that goes onto the PR with your commits (what you changed and why, in the PR's language, as the owner's words, without mentioning Seismic or agents). Once the owner approves, Seismic pushes your commits onto the PR's branch and posts the text. Findings for ${c.author} decided together with yours, or while yours wait for the owner, go with them in the same text, not with request_changes. In the squash merge ${c.author} stays its author.`
        : `- ${c.author} does not allow maintainers' edits, so findings go to them or become follow-up tasks.`,
      '- As a follow-up task: you make it a task of its own beside your card, outside this PR (follow_up_task), which marks it later in your findings. Findings that belong together become one task: as the owner\'s words say first, else as you bundled them in your findings (with), so bundle there only what one worker would sensibly do in one go.',
      'Words of the owner\'s that ask the same in so many words (“send them finding 1”, “fix that yourself”) count the same. Anything else they say (a question, more to look at) you answer or do on the card, and nothing goes to the PR.',
    ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** The end of the briefing in a folder without git: where the card works, and how it hands over without a branch. */
function folderBriefing(self: BriefingHost, cardId: string, parts: string[], resumed: boolean): string {
  const changed = self.folder!.changed(cardId).length;
  parts.push(
    `You work directly in the folder ${self.o.board.row(cardId).workstation}, which is not a git repository: what you change there is there at once, for everyone.${resumed && changed ? ` Your card changed ${changed === 1 ? 'one file' : `${changed} files`} there before; the card lists them.` : ''}`,
  );
  if (self.o.adapter.setup) parts.push(`First run \`${self.o.adapter.setup}\` in the folder.`);
  const run = self.o.adapter.app?.run?.trim();
  if (run) parts.push(`How to run the app: ${run} Once it runs and opens in a browser, give its address with app_running, so the owner can try it by hand from the card.`);
  if (self.o.adapter.checks?.length) parts.push(`Before ready_for_review, run: ${self.o.adapter.checks.map((c) => `\`${c}\``).join(', ')}.`);
  parts.push(
    [
      'Then hand it over with ready_for_review: your summary says what you did and what the owner needs to know, and its files name the files that are the result for the owner (a document, a report, a spreadsheet), which the card shows first. The card shows the owner what you changed in the folder, file by file (added, changed, moved, deleted, with the changed lines of text files), and they may discard those changes before approving.',
      `A demo is needed only where something can be seen: a draft or an overview to look at as an HTML artifact (an index.html in a new directory under ${self.demosDir(cardId)}, outside the folder, self-contained or with the files it loads beside it, made for the owner to decide on), handed over with kind 'html'; something that happens on screen as a video, recorded with ${self.demoSkill(cardId)}.`,
    ].join(' '),
  );
  return parts.join('\n\n');
}

/** What the worker of an idea, or of a workstream of the plan it became, built on a prototype hears of it: what the branch holds, the prototype's handover and the owner's answers on it. */
function builtOnPrototype(self: BriefingHost, prototypeId: string, workstream: boolean): string {
  const prototype = self.o.board.card(prototypeId);
  const summary = self.o.board.summary(prototypeId)?.trim();
  const answers = self.o.board.decisionsOn(prototypeId);
  return [
    `The owner chose to build this ${workstream ? 'workstream' : 'idea'} on the prototype “${prototype?.title ?? ''}”${workstream ? `, one of those built for the idea the plan came from` : ''}, and your branch is that prototype's. It is a throwaway prototype: built quickly to show the idea, without tests, polish or docs, with shortcuts. Take over what carries and bring it to production quality: tests, the repository's checks, the design doc and other docs, shortcuts removed. Rewrite or drop what does not hold up; nothing on the branch counts as reviewed code. The task is ${workstream ? 'the workstream as its plan doc describes it' : "the idea's brief above"}; the prototype is a means to it, not the result.`,
    summary ? `The prototype's worker handed it over with this summary:\n\n${summary}` : '',
    answers.length ? `What the owner answered on the prototype:\n${answers.map((d) => `- ${d.question} → ${d.answer}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The mocks of an idea's brief as a worker reads them, after the brief they belong to. */
function mocksText(mocks: Mock[] | undefined): string {
  if (!mocks?.length) return '';
  return ['Mocks of the brief, as the owner saw them rendered (how its variants look):', ...mocks.map((m) => `${m.title || 'Mock'}:\n\n\`\`\`html\n${m.html}\n\`\`\``)].join('\n\n');
}
