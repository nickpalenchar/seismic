// Every table of Seismic's database, each defined in its model: what the shared Drizzle connection
// (`Store.orm`, db.ts) knows, with the relations its relational queries follow (`with: { idea: true }`). It must describe the database the migrations in db.ts build;
// schema.test.ts holds it to that.

export { activity } from './activity';
export { agentRuns } from './agent-runs';
export { canvases } from './canvases';
export { cards, cardsRelations } from './cards/cards';
export { cardDemos, cardDemosRelations, cardEarlierDemos, cardEarlierDemosRelations } from './cards/demos';
export { cardHolds, cardHoldsRelations } from './cards/holds';
export { cardIdeas, cardIdeasRelations } from './cards/ideas';
export { cardLabels, cardLabelsRelations } from './cards/labels';
export { cardPlans, cardPlansRelations } from './cards/plans';
export { cardReviews, cardReviewsRelations } from './cards/reviews';
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
