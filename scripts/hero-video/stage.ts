



import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const PORT = 4730;
const APP = join(import.meta.dirname, 'tipjar');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function writeStage(file: string) {
  const all = Object.fromEntries(files(APP).map((p) => [relative(APP, p), readFileSync(p, 'utf8')]));
  const plans = Object.fromEntries(Object.entries(all).filter(([p]) => p.startsWith('docs/plan/')));
  const rest = Object.fromEntries(Object.entries(all).filter(([p]) => !p.startsWith('docs/plan/')));
  const stage = {
    port: PORT,
    dir: `/tmp/seismic-scratch-${PORT}`,
    name: 'Tipjar',
    
    files: rest,
    plans,
    cards: [
      { key: 'P', plan: 'docs/plan/tipjar-2.md', x: 60, y: 120 },
      { key: 'D', title: 'Dark mode', body: 'Tipjar follows the system’s dark mode.', state: 'live', x: 1030, y: 110, createdAgo: '1d' },
      
      {
        key: 'Q',
        title: 'Remember the last tip',
        body: 'Tipjar opens with the tip percentage chosen last time.',
        state: 'proposal',
        from: 'D',
        row: { proposal: { reason: 'Noticed while working on Dark mode: most people pick the same tip every time.', questions: [] } },
      },
      
      {
        key: 'R',
        title: 'A script that serves Tipjar for demos',
        body: 'Agents searched for how to serve the app before recording a demo. A script `bun run serve` starts it on a free port and prints the URL.',
        state: 'proposal',
        
        
        archivedAgo: '1m',
        x: 1460,
        y: 330,
        row: { retro: 'On three cards the agent first searched for how to serve the app before it recorded its demo.' },
      },
      
      { key: 'C', title: 'Run the tests on every push', body: 'A GitHub Actions workflow runs bun test on every push and pull request.', state: 'working', statusLine: 'Writing the workflow', scope: ['.github/workflows/test.yml'], x: 610, y: 110 },
      { key: 'I', title: 'App icon', body: 'An icon for the home screen.', state: 'waiting', need: 'question', question: { text: 'Which of the three drafts should become the icon?', options: ['The jar', 'The coin', 'The receipt'] }, scope: ['icon.svg'], x: 610, y: 290 },
      {
        key: 'T',
        title: 'Settle up after a trip',
        body: 'Several bills over a weekend, several people: who owes whom at the end.',
        state: 'idea',
        x: 620,
        y: 560,
        
        events: [
          { kind: 'talk', author: 'explorer', text: 'Who pays during the trip: does each person pay some of the bills, or does one person pay for everything and the others pay back?', ago: '50m' },
          { kind: 'talk', author: 'owner', text: 'Everyone pays some of the bills.', ago: '45m' },
          {
            kind: 'talk',
            author: 'explorer',
            text: 'Then a trip needs a shared list of bills, and at the end the balances: who pays whom, in as few transfers as possible. Those are several parts that build on each other, so I would make it a plan.',
            ago: '44m',
          },
        ],
        row: {
          idea: {
            status: 'open',
            brief: 'Settle a whole trip, not one bill: several bills, several people, who pays whom.\n\n## Variants\n- A shared list of bills per trip\n- Balances and who pays whom\n\n## Effort\nSeveral parts that build on each other: a plan.',
            thinking: false,
            yourTurn: true,
            questions: [],
            next: { step: 'planDoc', why: 'Several parts that build on each other.' },
            variants: [],
            mocks: [],
          },
        },
      },
    ],
    
    preferences: [
      { text: 'Questions to me with at most three options.' },
      { text: 'Solve rebase conflicts yourself.' },
      { text: 'Every change to the bill gets a test with cents that do not split evenly.', state: 'proposed', card: 'C', quote: 'Test it with an odd amount, like 100 split three ways.' },
    ],
    
    groups: [
      { name: 'Tipjar 2.0', cards: ['P'] },
      { name: 'Launch', cards: ['C', 'I'] },
    ],
  };
  writeFileSync(file, JSON.stringify(stage, null, 1));
}
