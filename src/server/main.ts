// obeya [--config <projects.json>]
// obeya <repo>… [--name <project>] [--workstation <path>]… [--clones <n>]
//   [--port <n>] [--dev] [--permission-mode <mode>] [--idle-workers | --record <dir> | --replay <dir>]
//
// Serves projects at http://127.0.0.1:<port>, to the owner alone (owner.ts): it prints a link that
// signs a browser in, and a second start while it runs prints a new one. Without repositories: the projects the JSON file
// lists, `[{ "name"?, "id"?, "repos": [{ "path", "workstations"?, "clones"? }] }]`, by default
// $SEISMIC_HOME/projects.json; while that does not exist, none, and the page shows the setup
// assistant, which checks the machine and creates the first project (machine.ts). With repositories: one project with them (the first is its home;
// --workstation and --clones apply to it). Data lives in $SEISMIC_HOME/obeya.db (default
// ~/.obeya).
//
// Without --dev the process supervises the server: it runs it as a child and starts it again
// when the server exits to pick up new code on Seismic's own checkout (self-update.ts); new commits
// on that checkout's upstream show in the bar, for the owner to pull (source-update.ts). A
// configuration the owner saves applies while the server runs (config.ts, `Projects`); saved while
// the projects came from the command line, it starts the server again, from the file from then on.
//
// Ctrl-C, SIGTERM or `POST /api/stop` (the app, app/, and Windows, which has no SIGTERM) stops
// Seismic the way a restart goes: workers in the middle of a turn hear of it and pause, and Seismic
// ends once none is (at most 15 minutes); a second Ctrl-C ends it at once. Workers it stopped are
// resumed when Seismic starts again. Installing a newer version of the app (`POST
// /api/app-update/install`) goes the same way, and then Seismic ends with UPDATE for the app's shell,
// which installs it and starts the app again. So does the Mac app taking over an Seismic that runs
// without the app that started it (`POST /api/app-takeover`): Seismic ends with TAKEOVER, marks its
// entry so, and the app starts it again. The app starts Seismic with SEISMIC_FROM_APP, which its entry
// records (`app`).
//
// One Seismic per home (instance.ts): a start on a home where one runs says where and ends. The
// running one has its port and pid in $SEISMIC_HOME/server.json; while its server starts again, a
// start waits for it.
//
// --idle-workers: no agent works on a started card (a scratch Seismic for a demo, scripts/scratch-obeya.ts).
// --record <dir>: every agent's session is recorded into <dir>; --replay <dir> plays such a recording
// back instead of running agents (replay.ts; why it refuses goes into $SEISMIC_HOME/replay-refused.txt).
// SEISMIC_PARK_GRACE=<seconds>: how long a waiting card's app runs on before Seismic stops it
// (Parking; 300 by default), shorter for a demo or a live check.
// SEISMIC_FORGE_FILE=<file.json>: pull requests come from that file instead of GitHub or Forgejo
// (file-forge.ts), for a scratch Seismic whose demo plays a forge; SEISMIC_PR_POLL=<seconds>: how often
// the watcher looks at open pull requests (120 by default).

import { bothNames, seismicEnv } from '../core/env';
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { DeveloperView, RestartReason } from '../core/types';
import { type ProjectConfig, Projects } from './project';
import { adoptOldConfig, Config, CONFIG_FILE, expandConfig, readConfigFile } from './config';
import { checkPlugin } from './demo';
import { UnusableDatabase } from './db';
import { Store } from './store';
import { SessionRegistry, useSessionRegistry } from './session-registry';
import { ghForge, routedForge } from './forge';
import { forgejoForge, originOf } from './forgejo';
import { fileForge } from './file-forge';
import { NarrationHost } from './narration';
import { claudeExecutable, endAgentsHere, sdkRuntime } from './runtime';
import { workerHarnessRuntime } from './worker-runtime';
import { claim, release, restarting, running, takenOver } from './instance';
import { recordingRuntime, replayRuntime } from './replay';
import { MachineSetup, welcome } from './machine';
import { addToPath, extendPath } from './path';
import { headOf, installDependencies, ownCheckout, reinstallDependencies, RESTART, RESTART_FROM_FILE, RESTART_PATIENCE_MS, Restarter, TAKEOVER, UPDATE, watchOwnCode } from './self-update';
import { AppUpdates } from './app-update';
import { SourceUpdates } from './source-update';
import { claudeUsage, UsageMeter } from './usage';
import { COMPILED, resource, SELF, VERSION } from './resources';
import { oldLinuxBun, onGitHub } from './repo';
import { Access } from './remote';
import { Push } from './push';
import { Awake } from './awake';
import { claudeToken } from './hosts';
import { serve, serveNarration } from './server';
import { LocalTranscriber, VoiceIn } from './voice';
import { VoiceSetup } from './voice-setup';
import { useLib } from '../../plugin/skills/demo/lib/here.ts';
import { DEMO_SETTINGS_FILE, expandHome, readDemoSettings } from '../../plugin/skills/demo/lib/settings.ts';
import { DemoSpace } from './demo-space';
import { qwen3Serve } from '../../plugin/skills/demo/lib/voices.ts';
import { agentSetting, agentsView, conversationLanguage, feedbackPromptView, ownerLanguage, usageMeterView } from './settings';
import { loginLink } from './owner';
import { Stalls } from './stalls';
import { hideConsoleWindows } from './spawn';

// before anything starts a program: git and the rest flash no window on Windows
hideConsoleWindows();

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: 'string' },
    name: { type: 'string' },
    port: { type: 'string', default: seismicEnv('PORT') ?? '4417' },
    dev: { type: 'boolean', default: false },
    workstation: { type: 'string', multiple: true, default: [] },
    // its name before
    workspace: { type: 'string', multiple: true, default: [] },
    clones: { type: 'string' },
    'permission-mode': { type: 'string', default: 'auto' },
    'idle-workers': { type: 'boolean', default: false },
    record: { type: 'string' },
    replay: { type: 'string' },
  },
  allowPositionals: true,
});

const home = seismicEnv('HOME') ?? join(homedir(), '.obeya');
// the home holds the logins, the cards and the agents' transcripts: the owner's alone
mkdirSync(home, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32' && (statSync(home).mode & 0o077) !== 0 && statSync(home).uid === process.getuid?.()) chmodSync(home, 0o700);
// a machine that runs on a token runs on the newest one the owner gave Seismic (claude-token), not one its environment kept since
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) process.env.CLAUDE_CODE_OAUTH_TOKEN = claudeToken(home) ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
// what the official installers and Homebrew install is found from a process the desktop started too
extendPath();
// and from a checkout the bun this runs on, for the workers' and scripts' `bun` (the app's shell names it by its path)
if (!COMPILED) addToPath(process.env, [dirname(process.execPath)]);
// the demo skill's modules this server carries inside the binary find their files among the resources
if (COMPILED) useLib(resource('plugin', 'skills', 'demo', 'lib'));
if (!values.config) adoptOldConfig(home);
const configFile = values.config ? resolve(expandHome(values.config)) : join(home, CONFIG_FILE);

if (!seismicEnv('SUPERVISED')) {
  const other = await running(home);
  if (other) {
    // a new link to it, for a browser not signed in yet
    const link = await loginLink(other.url, home);
    console.error(`Seismic already runs on ${home}, at ${other.url} (pid ${other.pid}); one home serves one Seismic${link ? `\nOpen it signed in: ${link}` : ''}`);
    process.exit(1);
  }
}

if (!values.dev && !seismicEnv('SUPERVISED')) {
  let child: ReturnType<typeof Bun.spawn> | undefined;
  // the server stops once its workers paused; whatever exit code it ends with, nothing starts again
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, () => {
      stopping = true;
      child?.kill(sig);
    });
  let args = Bun.argv.slice(2);
  for (;;) {
    child = Bun.spawn([...SELF, ...args], {
      env: { ...process.env, ...bothNames({ SUPERVISED: '1' }) },
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    const code = await child.exited;
    if (code === TAKEOVER && !stopping) takenOver(home, process.pid);
    else if (stopping || (code !== RESTART && code !== RESTART_FROM_FILE)) release(home, process.pid);
    else restarting(home, process.pid);
    if (stopping) process.exit(code === RESTART || code === RESTART_FROM_FILE ? 0 : code);
    if (code === RESTART_FROM_FILE) {
      // the owner saved the configuration of projects given on the command line: the file is it now
      args = [
        '--config', configFile, '--port', values.port, '--permission-mode', values['permission-mode'],
        ...(values['idle-workers'] ? ['--idle-workers'] : []),
        ...(values.record ? ['--record', values.record] : []),
        ...(values.replay ? ['--replay', values.replay] : []),
      ];
      console.log(`Seismic: starting again with ${configFile}`);
    } else if (code === RESTART) console.log('Seismic: starting again with the new code');
    else process.exit(code);
  }
}

let started: ProjectConfig[];
const source = values.config || !positionals.length ? 'file' : 'args';
if (source === 'file' && !values.config && !existsSync(configFile)) {
  // the first start: the setup assistant creates the file
  started = [];
} else if (source === 'file') {
  if (!existsSync(configFile)) {
    console.error(`usage: obeya [--config <file>] | <repo>… [--name <project>] [--workstation <path>]… [--clones <n>]; [--port <n>] [--dev] [--permission-mode <mode>]
(without repositories Seismic reads ${configFile}, which does not exist)`);
    process.exit(2);
  }
  started = readConfigFile(configFile);
} else {
  started = [
    {
      ...(values.name ? { name: values.name } : {}),
      repos: positionals.map((path, i) =>
        i === 0
          ? {
              path: resolve(expandHome(path)),
              ...(values.workstation.length + values.workspace.length ? { workstations: [...values.workstation, ...values.workspace].map((w) => resolve(expandHome(w))) } : {}),
              ...(values.clones ? { clones: Number(values.clones) } : {}),
            }
          : { path: resolve(expandHome(path)) },
      ),
    },
  ];
}
const configs = expandConfig(started);

// What a crash of the Seismic before this one left running: agent sessions' processes it recorded
// (session-registry.ts). Ended before any card resumes; what cannot be ended stays recorded.
{
  const registry = new SessionRegistry(join(home, 'sessions'));
  useSessionRegistry(registry.supported ? registry : undefined);
  for (const r of registry.recover()) {
    if (r.outcome === 'busy' || r.outcome === 'cleared') continue;
    console.log(`Seismic: session ${r.label ?? r.generation} left by an earlier Seismic: ${r.outcome} (${r.detail})`);
  }
}

const store = (() => {
  try {
    return new Store(join(home, 'obeya.db'));
  } catch (e) {
    if (!(e instanceof UnusableDatabase)) throw e;
    console.error(`Seismic: ${e.message}`);
    process.exit(1);
  }
})();
// work that lands on the checkout this code comes from restarts the server, so what is live is what runs
const own = seismicEnv('SUPERVISED') ? ownCheckout() : null;
// the commit this server's code came from: what changed since decides what to install before a restart
const ranFrom = own && headOf(own);
let projects: Projects | undefined;
let server: ReturnType<typeof serve> | undefined;
let exitCode = RESTART;
const live = () => projects?.all() ?? [];
/** Starts the server again once no worker is in the middle of a turn, or when the owner says so. */
const busy = () => live().flatMap((c) => c.busy().map((card) => ({ project: c.id, card })));
const leave = (reason: RestartReason, forced = false) => {
  server?.stop(true);
  if (reason === 'stop') return shutdown(0, forced);
  if (reason === 'update') return shutdown(UPDATE);
  if (own && ranFrom) {
    // a rebuild the owner asked for installs whatever changed; a restart for new code only when its dependencies did
    const done = reason === 'rebuild' ? reinstallDependencies(own) : installDependencies(own, ranFrom);
    if (done.ran && done.ok) console.log(`Seismic: installed the new dependencies in ${own}`);
    else if (done.ran) console.error(`Seismic: installing the new dependencies in ${own} failed; starting again anyway\n${done.output}`);
  }
  // after a takeover the app starts it again, not the supervisor
  shutdown(reason === 'takeover' ? TAKEOVER : exitCode);
};
const restarter = new Restarter({
  busy,
  // a command in its undo window holds a restart off even when the page that said it reloads
  held: () => (live().some((c) => c.commander.holding()) ? ['voice'] : []),
  go: (reason, forced) => {
    // the app that asked hears the answer first, which may be the request that goes at once
    if (reason === 'takeover') return void setTimeout(() => leave(reason), 100);
    leave(reason, forced);
  },
});
// workers in the middle of a turn hear of a restart that waits for them, and pause for it
restarter.onChange(() => {
  const due = restarter.due();
  for (const c of live()) c.restartDue(due && { reason: due.reason, deadline: due.deadline });
});
const restart = (reason: RestartReason, why: string) => {
  if (!restarter.due()) console.log(`Seismic: ${why}; restarting${busy().length ? ' once no worker is in the middle of a turn' : ''}`);
  restarter.request(reason);
};
/** The commit the code runs from, for the settings beside the version; none for the compiled binary. */
const commitOf = () => {
  const checkout = own ?? ownCheckout();
  return ranFrom ?? (checkout && headOf(checkout));
};
const forgeFile = seismicEnv('FORGE_FILE');
const forge = forgeFile ? fileForge(forgeFile) : routedForge(ghForge, forgejoForge, originOf, (remote) => onGitHub(remote));
const narration = new NarrationHost({ argv: (voice, language) => qwen3Serve(voice, language, home), log: (line) => console.log(line) });
// what a demo's narration reaches of Seismic, for the voice it holds loaded (narration.ts): the
// narration and nothing else, from a worker here as from one on another machine (design: Hosts)
const narrationServer = serveNarration(narration);
const narrationUrl = `http://127.0.0.1:${narrationServer.port}`;
// the disk space demos take, and the frames of old renders deleted (demo-space.ts)
const demoSpace = new DemoSpace({ home, settings: () => readDemoSettings(home), file: join(home, DEMO_SETTINGS_FILE), log: (line) => console.log(line) }).start();
const config = new Config({
  file: configFile,
  source,
  started,
  store,
  running: () => live().map((c) => c.id),
  server: { port: Number(values.port), home, permissionMode: values['permission-mode'], commit: commitOf() },
  narrationUrl,
  forge,
  space: demoSpace,
  onSettings: () => {
    for (const c of live()) c.settingsChanged();
  },
  apply: (configs, ids) => projects?.apply(configs, ids),
  failures: () => projects?.failures() ?? [],
  ...(seismicEnv('SUPERVISED')
    ? {
        restart: () => {
          // projects from the command line come from the saved file from now on
          exitCode = RESTART_FROM_FILE;
          // after the answer is out: a restart with no worker to wait for stops this server at once
          setTimeout(() => restart('config', 'the configuration changed'), 100);
        },
      }
    : {}),
});
const runtime = agentRuntime();
projects = new Projects(
  configs,
  {
    store,
    home,
    runtime,
    ...(!values['idle-workers'] ? { workerRuntime: workerHarnessRuntime(runtime, values.record || values.replay ? { start() { throw new Error('Codex workers are not supported in record/replay mode'); } } : undefined, values.record || values.replay ? { start() { throw new Error('Antigravity workers are not supported in record/replay mode'); } } : undefined) } : {}),
    ...(values['idle-workers'] && !values.record && !values.replay ? { idleWorkers: true } : {}),
    forge,
    permissionMode: values['permission-mode'] as 'auto',
    watch: true,
    setupProposals: true,
    ownCheckout: own,
    config,
    workerEnv: bothNames({ URL: narrationUrl, NARRATION_URL: narrationUrl, HOME: home }),
    ...(seismicEnv('PARK_GRACE') ? { parkGrace: Number(seismicEnv('PARK_GRACE')) * 1000 } : {}),
    ...(seismicEnv('PR_POLL') ? { prPollMs: Number(seismicEnv('PR_POLL')) * 1000 } : {}),
    language: () => ownerLanguage(home),
    conversation: () => conversationLanguage(home),
    asksFeedback: () => feedbackPromptView(home).on,
    agents: (role) => agentSetting(home, role),
    codexAutoReview: () => agentsView(home).codexAutoReview,
    settings: (path) => config.repoSettings(path),
  },
  // the project the setup assistant created gets a first card that says what to try
  (c) => welcome(home, [c]),
);
/** The agents' runtime: the Agent SDK's, recorded (`--record`), or a recording played back (`--replay`). */
function agentRuntime() {
  if (values.record) return recordingRuntime(sdkRuntime, resolve(values.record), home);
  if (!values.replay) return sdkRuntime;
  const refusedFile = join(home, 'replay-refused.txt');
  rmSync(refusedFile, { force: true });
  return replayRuntime(resolve(values.replay), { home, refused: (why) => writeFileSync(refusedFile, `${why}\n`) });
}
const ids = projects.all().map((c) => c.id);
if (new Set(ids).size !== ids.length) {
  console.error(`two projects share an id: ${ids.join(', ')}; give them different names`);
  process.exit(2);
}
const transcriber = new VoiceIn(home, new LocalTranscriber());
const voiceSetup = new VoiceSetup({ home, local: transcriber.local });
const updates = new AppUpdates();
// run from a clone of Seismic's repository: new commits on its upstream, for the owner to pull
const sources = own ? new SourceUpdates(own) : undefined;
// the plan's usage limits in the bar, while the owner has it show them and a page is open
const usage = new UsageMeter(() => claudeUsage(home), { on: usageMeterView(home).on });
const machine = new MachineSetup({ home, config, voice: voiceSetup });
// the project the assistant created gets a first card that says what to try
welcome(home, projects.all());
const shutdown = async (code: number, forced = false) => {
  // Force while the sessions and their process identities are still available.
  const agents = forced ? endAgentsHere(true) : undefined;
  projects?.shutdown();
  usage.stop();
  demoSpace.stop();
  await (agents ?? endAgentsHere());
  awake.stop();
  // what it counted of a page's stalls, before it goes
  stalls.stop();
  access.release();
  transcriber.stop();
  narration.stop();
  // the supervisor stays across a restart, and gives the entry up when it ends
  if (!seismicEnv('SUPERVISED')) (code === TAKEOVER ? takenOver : release)(home, process.pid);
  process.exit(code);
};
// stopping waits for the workers like a restart; a second Ctrl-C has it go ahead at once
const SAME_PRESS_MS = 1000;
let stopAsked = 0;
const stop = () => {
  if (!stopAsked) {
    stopAsked = Date.now();
    const n = busy().length;
    console.log(n ? `Seismic: stopping once no worker is in the middle of a turn (${n} ${n === 1 ? 'is' : 'are'}, at most ${RESTART_PATIENCE_MS / 60_000} minutes); Ctrl-C again stops at once` : 'Seismic: stopping');
    restarter.request('stop');
    return;
  }
  // Ctrl-C in the terminal reaches the supervisor too, which passes it on: one press arrives twice
  if (Date.now() - stopAsked < SAME_PRESS_MS) return;
  console.log('Seismic: stopping now');
  if (!restarter.now()) shutdown(0, true);
};
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, stop);

// other devices, when the owner lets them: the phone over the owner's own network
const access = new Access({ store, home, language: () => ownerLanguage(home) });
// and what starts waiting for the owner, pushed to the phones that turned notifications on
const push = new Push({ store, home, language: () => ownerLanguage(home) });
// while other devices may reach Seismic, the machine stays awake as long as a worker works, or the whole time
const awake = new Awake({ wanted: () => access.awake() === 'always' || (access.awake() === 'works' && busy().length > 0) }).start();
// what held the server up, or a page, for the owner to notice: in this log and in the home's stalls.log
const stalls = new Stalls({ home }).start();
// the Developer section: a restart needs the supervisor that starts the server again, a rebuild a checkout to install in
const developer: DeveloperView = seismicEnv('SUPERVISED')
  ? { restart: true, rebuild: !!(own && ranFrom), ...(own && ranFrom ? {} : { rebuildWhy: 'compiled' as const }) }
  : { restart: false, rebuild: false, why: 'dev' };
server = serve(projects, { transcriber, setup: voiceSetup }, Number(values.port), values.dev, config, restarter, narration, machine, stop, updates, access, push, sources, usage, stalls, developer);
claim(home, { pid: seismicEnv('SUPERVISED') ? process.ppid : process.pid, port: server.port!, url: `http://127.0.0.1:${server.port}`, version: VERSION, ...(seismicEnv('FROM_APP') ? { app: true } : {}) });
// the address as a one-time link that signs a browser in (owner.ts)
const link = access.owner.link(`http://127.0.0.1:${server.port}`);
console.log(`Seismic ${own ? `from ${own}` : VERSION} on ${link} (${source === 'file' ? configFile : 'projects from the command line'}), agents on ${claudeExecutable() ?? 'the Claude Code the Agent SDK brings'}`);
// from the commit the server started from: a landing since is new code to it, not where it started
if (own && ranFrom) watchOwnCode(own, ranFrom, (from, to) => restart('code', `${own} moved from ${from.slice(0, 7)} to ${to.slice(0, 7)}`));
sources?.start();
if (!projects.all().length) console.log(`  no project yet: the setup assistant there checks this machine and creates the first`);
for (const c of projects.all()) {
  console.log(`  ${c.board.project.name} (/p/${c.id})`);
  for (const r of c.repos)
    console.log(
      `    ${r.ref.id}: ${r.info.path} (${r.info.folder ? 'a folder without git: every card works in it' : r.adapter.workstations === 'worktrees' ? 'a worktree per card' : `clones: ${r.workstations.list().map((w) => w.path).join(', ') || 'none (--workstation or --clones)'}`})`,
    );
}
const plugin = checkPlugin();
if (plugin) console.warn(`Seismic: warning: ${plugin}`);
// once the deadlock struck, the project does not load and cannot show its warning: the log says it too
if (oldLinuxBun())
  console.warn(
    `Seismic: warning: Bun ${Bun.version} is too old; Seismic needs Bun 1.3.14 or later. On Linux this Bun can deadlock a thread of its work pool when a file watch closes, and then the project stops loading. Upgrade it with \`bun upgrade\` and start Seismic again.`,
  );
