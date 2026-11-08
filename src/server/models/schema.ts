// Every table of Seismic's database, each defined in its model: what the shared Drizzle connection
// (`Store.orm`, db.ts) knows. It must describe the database the migrations in db.ts build;
// schema.test.ts holds it to that.

export { activity } from './activity';
export { agentRuns } from './agent-runs';
export { canvases } from './canvases';
export { cards } from './cards/cards';
export { chats } from './chats';
export { commands } from './commands';
export { decisions } from './decisions';
export { devices } from './devices';
export { events } from './events';
export { feedback } from './feedback';
export { folderCards } from './folder-cards';
export { friction } from './friction';
export { groups } from './groups';
export { preferences } from './preferences';
export { projects } from './projects';
export { settingProposals } from './setting-proposals';
export { settings } from './settings';
export { talk } from './talk';
export { trustedCommands } from './trusted-commands';
export { workstations } from './workstations';
