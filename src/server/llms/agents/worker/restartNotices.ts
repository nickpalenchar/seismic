



import type { Pause } from '../../../../core/messages';
import type { RestartReason } from '../../../../core/types';


export interface DueRestart {
  reason: RestartReason;
  deadline: number;
  
  repo?: boolean;
}

/** What the worker pauses for, as the card's log says it. */
export const pauseOf = (due: DueRestart): Pause => (due.reason === 'stop' ? 'stop' : due.repo ? 'repo' : 'restart');

const DUE_WHY: Record<RestartReason, string> = {
  code: 'restart (new code landed on main)',
  config: 'restart (the owner saved a new configuration)',
  repository: "restart (a repository's settings changed on its default branch)",
  owner: 'restart (the owner restarts it)',
  rebuild: 'restart (the owner rebuilds it: its dependencies are installed again)',
  stop: 'stop (the owner is shutting it down)',
  update: 'restart (the owner installs a new version of the app)',
  takeover: 'restart (the app takes over this Seismic, which ran without it)',
};


const REPO_WHY: Partial<Record<RestartReason, string>> = {
  config: 'the owner changed its configuration',
  repository: 'its settings changed on its default branch',
};

/** What is about to happen, who it stops, and when the worker goes on, for the messages below. */
const dueText = (due: DueRestart) =>
  due.repo
    ? {
        what: `restart this repository's agents (${REPO_WHY[due.reason] ?? REPO_WHY.config}), you among them,`,
        whom: 'none of them',
        thing: "restart of this repository's agents",
        back: 'once it has restarted them',
      }
    : { what: `${DUE_WHY[due.reason]} and stops whatever its workers run at that moment.`, whom: 'no worker', thing: DUE_WHY[due.reason], back: 'once it runs again' };

/** How long Seismic waits for the restart at most, as the messages below say it. */
const minutesLeft = (due: DueRestart) => {
  const minutes = Math.max(1, Math.round((due.deadline - Date.now()) / 60_000));
  return `at most ${minutes} more minute${minutes === 1 ? '' : 's'}`;
};

/** What is about to happen and how long Seismic waits for it, as the messages to a worker in a turn begin. */
const dueOpening = (due: DueRestart) => {
  const d = dueText(due);
  return `Seismic is about to ${due.repo ? `${d.what} which stops whatever you run at that moment.` : d.what} It waits until ${d.whom} is in the middle of a turn, ${minutesLeft(due)}`;
};

/** Tells a worker that Seismic is about to restart or stop, so that it pauses at a safe point instead of being cut off. */
export const restartNotice = (due: DueRestart) =>
  `${dueOpening(due)}. Pause at the next safe point: finish the step you are in, start nothing long (a test run, a demo render, a measurement), and end your turn, without handing over if you are not done. Background commands still running keep Seismic waiting: let those you need finish, stop the others (a scratch server you can start again). One that finishes before the restart wakes you for a turn that keeps Seismic waiting too: take in its result and end that turn as well. Seismic resumes you ${dueText(due).back}, and you go on from there.`;

/**
 * Tells a worker whose turn a message starts while a restart is due (a conflict after an approval,
 * an answer, a card started) that the turn keeps Seismic waiting: it takes the message in and leaves
 * what it asks for until Seismic resumes it, instead of judging a step short enough to do first.
 */
export const restartWaits = (due: DueRestart) =>
  `${dueOpening(due)}, and this turn keeps it waiting. Take in this message, leave the work it asks for until Seismic resumes you, and end your turn, without handing over. Seismic resumes you ${dueText(due).back}, and you do that work then.`;

/** Tells a worker that paused for the restart, and was woken before it (by its background work, a message), that Seismic still waits for it. */
export const stillDue = (due: DueRestart) =>
  `Seismic still waits for the ${dueText(due).thing} you paused for, ${minutesLeft(due)}, and this turn keeps it waiting. Take in what started it (a background command that finished, a message), leave the work it leads to until Seismic resumes you, and end your turn.`;


export const PAUSE_STILL =
  'The owner still waits for you to pause, and this turn keeps them waiting. Take in what started it (a background command that finished), leave the work it leads to until the owner lets you go on, and end your turn.';
