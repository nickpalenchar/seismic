// The looks of Seismic's configuration (Tailwind on frost's tokens), shared by the Configuration and Preferences
// dialogs (config.tsx, prefs.tsx), the project's settings sheet (projectSettings.tsx) and the parts of other
// views that build on them (access.tsx, performance.tsx): a dialog nearly as large as the window, its sections
// listed on the left and the one chosen on the right; settings as rows of label and control, without boxes.
// The class names before the utilities (`cfg-field`, `cfg-control` …) stay as hooks for code, demos and the
// rules of other families that find the element.

import { cn } from 'cn';

/** Inside the configuration's dialogs and the settings sheet: text fields as wide as their place, a switch or checkbox a little below what is above it. */
const inside = '[&_textarea]:w-full [&_[data-slot=check-label]]:[margin:8px_0_0]';

/** The dim around Configuration and Preferences, which places the box. */
export const cfgLayerClass = 'z-55 items-stretch p-7 max-[900px]:p-2.5';

/** The dialog's box: one frosted glass, the navigation beside the section shown, above it in a narrow window. */
export const cfgBoxClass = cn(
  'cfg-box flex-1 grid grid-cols-[230px_minmax(0,1fr)] min-w-0 overflow-hidden relative max-[900px]:grid-cols-[1fr] max-[900px]:grid-rows-[auto_minmax(0,1fr)]',
  inside,
);

/** The settings sheet of a project (a docked sheet), with the same fields as the dialog. */
export const settingsSheetClass = inside;

/** The navigation down the left; in a narrow window a wrapping row over the section. */
export const cfgNavClass =
  'cfg-nav flex flex-col pt-[22px] px-3.5 pb-[18px] bg-transparent border-r border-r-line overflow-y-auto [--button-bg:var(--panel)] max-[900px]:flex-row max-[900px]:flex-wrap max-[900px]:items-center max-[900px]:gap-y-1 max-[900px]:gap-x-2.5 max-[900px]:p-3';

/** What the dialog is, over its title (the look of `.p-kind`); not in a narrow window. */
export const cfgKindClass =
  'flex flex-wrap items-center gap-y-1 gap-x-2.5 min-h-[22px] px-2.5 text-[11px] uppercase tracking-[.08em] text-muted-foreground max-[900px]:hidden';

/** The dialog's title. */
export const cfgTitleClass = 'px-2.5 mt-0.5 mx-0 mb-[18px] text-[24px] max-[900px]:m-0 max-[900px]:mr-2 max-[900px]:text-[20px]';

/** The note on asking Seismic, under the title; not in a narrow window. */
export const cfgAskClass = 'cfg-ask -mt-1.5 mb-[22px] mx-0 px-2.5 max-[900px]:hidden';
export const cfgAskHintClass = 'm-0 mb-3.5 leading-[1.45]';

/** The list of sections. */
export const cfgNavListClass = 'list-none m-0 p-0 max-[900px]:flex max-[900px]:flex-wrap max-[900px]:gap-0.5 max-[900px]:pr-9';

const navEntry =
  'w-full flex items-center gap-2 px-2.5 [border:0] rounded-[8px] bg-transparent text-ink text-left cursor-pointer hover:[&:not([data-state=active])]:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:shadow-[inset_0_1px_0_var(--glass-hi),var(--shadow)] max-[900px]:w-auto max-[900px]:px-2.5';

/** A section in the list; `nested` for a project, indented under the heading of the projects. */
export const cfgNavEntryClass = (nested?: boolean) =>
  cn(navEntry, 'py-2 text-[14px] max-[900px]:py-1.5 max-[900px]:text-[13px]', nested && 'pl-6 max-[900px]:pl-2.5');

/** "+ Project", last under the projects: quieter. */
export const cfgNavAddClass = cn(navEntry, 'cfg-nav-add py-[5px] pl-6 text-[13px] text-muted-foreground hover:text-ink max-[900px]:pl-2.5');

/** Projects: a heading over the projects, each indented under it, and "+ Project" last. In a narrow window they join the row. */
export const cfgNavGroupClass = 'cfg-nav-group max-[900px]:contents';
export const cfgNavTitleClass =
  'cfg-nav-title flex items-center gap-2 pt-2 px-2.5 pb-1 text-[14px] text-muted-foreground max-[900px]:py-1.5 max-[900px]:pl-2.5 max-[900px]:pr-1 max-[900px]:text-[13px]';
export const cfgNavGroupListClass = 'list-none m-0 mb-1.5 p-0 max-[900px]:contents max-[900px]:flex-wrap max-[900px]:gap-0.5 max-[900px]:pr-9';
export const cfgNavNameClass = 'cfg-nav-name min-w-0 truncate';

/** Changes not saved yet. */
export const cfgDotClass = 'cfg-dot flex-none size-[7px] rounded-[50%] bg-waiting';

/** At the navigation's foot; not in a narrow window. */
export const cfgNavFootClass = 'cfg-nav-foot mt-auto pt-[18px] px-2.5 pb-0 max-[900px]:hidden';

/** The dialog's close button: on the box, not in the scrolling column, so it stays in view however far that scrolls. */
export const cfgCloseClass = 'cfg-close absolute right-[22px] top-3.5 z-2 max-[900px]:right-3 max-[900px]:top-3';

/** The column of the section shown; the right padding keeps a lane for the close button, so nothing scrolls under it or stands beside it. */
export const cfgMainClass = 'cfg-main relative overflow-y-auto pt-[26px] pr-[66px] pb-0 pl-10 max-[900px]:pt-[18px] max-[900px]:px-[18px] max-[900px]:pb-0';

/** A section. */
export const cfgSecClass = 'cfg-sec max-w-[1180px] pb-8 [&[hidden]]:hidden';

/** The heading face, a little heavier. */
const headingFace = '[font-family:var(--font)] font-[650] tracking-[-.018em]';

/** A section's title (in the settings sheet a smaller one), or a part's (`sub`), apart from what is above it unless it follows the section's title. */
export const cfgHeadClass = (sub?: boolean) =>
  cn(
    'cfg-head mb-3.5 [#project-settings_&]:mt-[22px]',
    sub && 'sub mt-[30px] pt-[22px] border-t border-t-line [.cfg-head:not(.sub)+&]:mt-0 [.cfg-head:not(.sub)+&]:pt-1 [.cfg-head:not(.sub)+&]:border-t-0',
  );
export const cfgHeadTitleClass = cn('m-0 mr-12 mb-1.5 text-[26px] leading-[1.15] [#project-settings_&]:m-0 [#project-settings_&]:mb-1 [#project-settings_&]:text-[16px]', headingFace);
export const cfgHeadSubTitleClass = 'm-0 mb-1 text-[15px]';

/** What a heading is about, and the file it is saved in. */
export const cfgHeadHintClass =
  'text-muted-foreground text-[13px] max-w-[76ch] m-0 mb-1 leading-normal [#project-settings_&]:m-0 [#project-settings_&]:text-[12.5px] [#project-settings_&]:leading-[1.45]';
export const cfgHeadFileClass =
  'cfg-file text-muted-foreground text-[12px] max-w-[76ch] m-0 mb-1 leading-normal [#project-settings_&]:m-0 [#project-settings_&]:text-[12.5px] [#project-settings_&]:leading-[1.45]';

/**
 * A setting: its name on the left, the control and what to know about it on the right; under each other in a
 * narrow window and in the settings sheet. On a project's page labels line up with the top of their controls,
 * which are often several lines high.
 */
export const cfgFieldClass =
  'cfg-field grid grid-cols-[200px_minmax(0,1fr)] gap-x-6 items-baseline py-[7px] px-0 text-[13.5px] max-[900px]:grid-cols-[1fr] max-[900px]:gap-y-1 [#phone_&]:grid-cols-[150px_minmax(0,1fr)] [#project-settings_&]:grid-cols-[1fr] [#project-settings_&]:gap-y-0.5 [.cfg-project_&]:[align-items:start]';
export const cfgLabelClass = 'cfg-label text-muted-foreground text-[13px] [.cfg-project_.cfg-field>&]:pt-[7px]';
export const cfgControlClass =
  'cfg-control min-w-0 max-w-[640px] [&>.c-path]:w-full [&>.c-path]:max-w-[420px] [&>[data-slot=select-trigger]]:w-full [&>[data-slot=select-trigger]]:max-w-[420px] [&>[data-slot=button]]:mt-1.5';

/** A repository's setting: where its value comes from beside its name, "Reset" where it is set here; marked a moment when the dialog was opened at it. */
export const cfgSettingClass = cn(cfgFieldClass, 'cfg-setting [align-items:start] [&_textarea]:max-w-[640px] [&.flash]:animate-[cfg-setting-flash_2.4s_ease-out]');
export const cfgSettingLabelClass = cn(cfgLabelClass, 'flex flex-wrap items-baseline gap-y-0.5 gap-x-2 pt-[7px]');

/** Where a setting's value comes from: this machine's in the working colour. */
export const cfgSourceClass = (here: boolean) =>
  cn('cfg-source text-[11.5px]', here ? 'here text-working' : '[color:color-mix(in_srgb,var(--muted-foreground)_80%,var(--panel))]');

/**
 * What to know about a field: an icon beside its label, shown only while the pointer is on the field or the
 * label (the nearest `.cfg-has-info`) or the field has the focus.
 */
export const cfgInfoClass =
  'cfg-info inline-flex align-[-3px] ml-0.5 py-0 px-px [border:0] bg-transparent text-muted-foreground cursor-help leading-[0] opacity-0 [transition:opacity_.12s] [.cfg-has-info:is(:hover,:focus-within)_&]:opacity-100 [.cfg-has-info:is(:hover,:focus-within)_.cfg-has-info:not(:hover,:focus-within)_&]:opacity-0 hover:opacity-100 hover:text-ink [&.on]:opacity-100 [&.on]:text-ink focus-visible:opacity-100 focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-muted-foreground focus-visible:outline-offset-1 focus-visible:rounded-[50%]';

/** A group of a repository's settings under a small heading; marked a moment when the dialog was opened at its clones. */
export const cfgGroupClass = (flash?: boolean) => cn('cfg-group mt-[18px] rounded-[2px]', flash && 'flash animate-[cfg-flash_2.4s_ease-out]');
export const cfgGroupHeadClass = 'cfg-group-head m-0 mb-0.5 text-[11.5px] font-semibold tracking-[.06em] uppercase text-muted-foreground';

/** The save buttons stay in view at the foot of the section; solid under reduced motion. */
export const cfgActionsClass =
  'cfg-actions sticky bottom-0 z-1 flex flex-wrap items-center gap-2.5 mt-5 pt-3.5 px-0 pb-[18px] bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] backdrop-blur-[16px] border-t border-t-line reduced:bg-panel [&_.c-status]:m-0! [&_.c-status]:text-[12.5px]!';

/** Columns side by side as far as they fit, one under the other in a narrow window. */
export const cfgColsClass = 'cfg-cols grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-y-0 gap-x-14 [align-items:start] max-[900px]:grid-cols-[1fr] [&>.c-setup>.cfg-head.sub]:mt-0 [&>.c-setup>.cfg-head.sub]:pt-0 [&>.c-setup>.cfg-head.sub]:border-t-0';

/** A setting with several fields (the demo site), each labelled above it; `.wide` ones span the row. */
export const cfgSubClass =
  'cfg-sub grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-y-2 gap-x-3 max-w-[640px] [&>label]:flex [&>label]:flex-col [&>label]:gap-[3px] [&>label]:min-w-0 [&>div]:flex [&>div]:flex-col [&>div]:gap-[3px] [&>div]:min-w-0 [&>.wide]:col-span-full [&>div>[data-slot=toggle-group]]:self-start [&_input]:w-full [&_textarea]:w-full';
/** The label of a field in it (the look of `.hint`, smaller). */
export const cfgSubHintClass = 'text-muted-foreground text-[11.5px]';

/** A link in the configuration's text: blue and underlined. */
export const cfgLinkClass = 'text-working [text-decoration:underline_1px_currentColor] underline-offset-[.2em]';

/** Buttons side by side under a demo site, adding one, a project's site. */
export const cfgPersonalActionsClass = 'personal-actions flex gap-2 items-center mt-2.5 mb-1 mx-0';
