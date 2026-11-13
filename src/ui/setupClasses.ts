// The looks the setup assistant (setup.tsx) shares with the configuration dialog (config.tsx), in
// Tailwind on frost's tokens: a machine's pieces, the fields for paths and commands, an installation
// going on, the problems the configuration found. The class names before the utilities (`c-path`,
// `c-install`, `c-problem` …) stay as hooks for code, demos and the configuration's own rules that
// find the element.

/** A framed block of the setup assistant: one of its checks, the first project. */
export const projectClass = 'c-project mt-4 mb-1.5 mx-0 pt-3 px-3 pb-2.5 border border-solid border-border rounded-[3px]';

/** A field for a path, a command or a setting's line: mono and small, taking the row's room. */
export const pathClass = 'c-path flex-1 min-w-0 [font-family:var(--mono)]! text-[12px]!';

/** Fields and buttons in a row; the button keeps its label on one line. */
export const rowClass = 'c-row flex gap-2 items-center my-1 mx-0 [&>[data-slot=button]]:flex-none';

/** What a machine needs: one line per piece (its mark, name and state), how to install a missing one below it. */
export const setupListClass = 'list-none p-0 my-1.5 mx-0';

/** A piece's line; the assistant gives its names a column of their own. */
export const setupItemClass =
  'grid grid-cols-[16px_auto_1fr] [.setup_&]:grid-cols-[16px_210px_1fr] gap-x-2 items-baseline py-[3px] px-0 text-[13px] [:is(#config,#prefs,#project-settings)_&]:py-[5px] [:is(#config,#prefs,#project-settings)_&]:text-[13.5px] [:is(#config,#prefs,#project-settings)_&]:border-b [:is(#config,#prefs,#project-settings)_&]:border-b-border [:is(#config,#prefs,#project-settings)_&:last-child]:border-b-0 [&_.hint]:m-0 [&_.hint]:[overflow-wrap:anywhere]';

/** An installation going on: its step, then the installer's last line, cut to one line. */
export const installClass =
  'c-install flex gap-2.5 items-center my-1 mx-0 text-[12.5px] [&_.hint]:m-0 [&_.c-step]:flex-none [&_code]:overflow-hidden [&_code]:text-ellipsis [&_code]:whitespace-nowrap [&_code]:min-w-0';

/** The same line as a hint: `.hint`'s colour, the line's size over `.hint`'s. */
export const installHintClass = `hint ${installClass} text-[12.5px]!`;

/** What a save or a check answered, under the controls. */
export const statusClass = 'c-status mt-2';

/** The settings as JSON, as they would be saved. */
export const jsonClass = 'c-json [font:11.5px/1.4_var(--mono)] bg-muted rounded-[3px] p-2.5 overflow-auto';

/** A problem the configuration found, in the error colour, with its details and its buttons below it. */
export const problemClass =
  'c-problem text-destructive mt-1.5 mb-0 mx-0 text-[13px] [&_code]:block [&_code]:mt-1 [&_code]:whitespace-pre-wrap [&_code]:[overflow-wrap:break-word] [&>[data-slot=button]:not([data-variant=link])]:flex [&>[data-slot=button]:not([data-variant=link])]:w-fit [&>[data-slot=button]:not([data-variant=link])]:mt-1.5!';

/** A project's id, beside its title. */
export const idClass = (fresh: boolean) => `c-id [font:11.5px_var(--mono)] ${fresh ? 'fresh text-warning' : 'text-muted-foreground'}`;

/**
 * The waste bin that removes an entry, at its end: it shows while the pointer or focus is on its
 * entry; without a pointer that hovers, always.
 */
export const removeClass =
  'c-del c-remove ml-auto [&_svg]:block [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:duration-[120ms] [@media(hover:hover)]:[:is(.cfg-project-head,.cfg-repo-path,.cfg-host,.cfg-old-names_li):is(:hover,:focus-within)>&]:opacity-100';

/** A repository's commands that wait for the owner's trust: each group's lines as a diff, the button below. */
export const trustClass = 'c-trust flex flex-col items-start gap-2.5 mt-2';
export const trustGroupClass = 'c-trust-group self-stretch [&>.hint]:mt-0 [&>.hint]:mb-1 [&>.hint]:mx-0';

