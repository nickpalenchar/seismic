// The shared looks of the performance dashboard and the Agent Feedback Log (Tailwind on frost's
// tokens): their head, filters, empty states, tables and the stars of a response. The class names
// before the utilities (`perf-table`, `flog-back`) stay as hooks for code that finds the element.

/** The page's head: its title, the summary beside it, and on the dashboard the link to the log at the end. */
export const headClass = 'perf-head flex items-baseline gap-[18px] flex-wrap';
/** The title in the head. */
export const titleClass = 'm-0 text-[26px]';
/** What the page is, under its head. */
export const aboutClass = 'hint mt-1.5 mb-[18px] leading-[1.45]';
/** The filters at the start and what changes the view at the end, on their bottom line. */
export const barClass = 'flex items-end justify-between gap-4 flex-wrap mb-3.5';
export const filtersClass = 'flex items-end gap-3 flex-wrap';
/** A filter: its name over its select. */
export const choiceClass = 'flex flex-col gap-[3px] text-[12px] text-muted-foreground';
/** Clearing the filters, level with the selects' text. */
export const clearClass = 'text-[13px] leading-[1.25] pb-[9px]';
/** No responses at all, or none the filters let through. */
export const emptyClass = 'perf-empty text-center py-12 px-2.5 [&>[data-slot=button]]:mt-2';
/** A link to the other page, blue and underlined in its own colour (a text link's line is a faint pencil one). */
export const pageLinkClass = 'link text-[13.5px] text-working decoration-current!';
/** A table of responses: full width, a line under each row. */
export const tableClass = 'w-full border-collapse text-[14px]';
/** A rating as five stars, those not given faint. */
export const starsClass = 'text-waiting-strong tracking-[1px] whitespace-nowrap text-[15px]';
