// Menus (shadcn/ui's DropdownMenu, on Radix DropdownMenu): a button that opens a list of actions,
// links or radio choices, with arrow keys, typeahead, Esc and an outside click handled by Radix.
// Non-modal: the page stays live under an open menu, as the hand-built lists did. The list is
// portaled into `uiPortal()` and closes when a shortcut asks the bar's menus to make room
// (`closeBarMenus`).
//
// `Menu` is the root (`open` and `onOpenChange` to control it), `MenuTrigger` the button (`asChild`
// to use the caller's), `MenuContent` the panel (a class of the caller's sets its size, padding and
// corners), `MenuItem` an action (a button; `asChild` for a link or a chip, which then wears the
// caller's look), `MenuRadioGroup` and `MenuRadioItem` a choice with the current one marked,
// `MenuLabel` a heading. The left menu renders the same entries docked as a sidebar, outside any
// menu: `nav.tsx` decides by context whether an entry is a `MenuItem` or a plain button.

import { cn } from 'cn';
import { DropdownMenu } from 'radix-ui';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { uiPortal } from './ui';

/** Make room for another bar interaction opened from a keyboard shortcut. */
export const closeBarMenus = () => dispatchEvent(new Event('obeya:close-bar-menus'));

/** While `open`, `close` when a shortcut asks the bar's menus to make room; menus and popovers take it. */
export function useCloseBarMenus(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const dismiss = () => latest.current();
    addEventListener('obeya:close-bar-menus', dismiss);
    return () => removeEventListener('obeya:close-bar-menus', dismiss);
  }, [open]);
}

export function Menu({ open, onOpenChange, ...props }: Omit<ComponentProps<typeof DropdownMenu.Root>, 'modal'>) {
  useCloseBarMenus(!!open, () => onOpenChange?.(false));
  useEffect(() => {
    if (open) leaving = false;
  }, [open]);
  return <DropdownMenu.Root data-slot="dropdown-menu" modal={false} open={open} onOpenChange={onOpenChange} {...props} />;
}

export function MenuTrigger(props: ComponentProps<typeof DropdownMenu.Trigger>) {
  return <DropdownMenu.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

// Radix returns focus to the trigger when a menu closes. A choice that opens a view (a dialog, a
// confirm, another page) calls `leaveMenu()` first: that view takes the focus, the trigger behind
// it does not.
let leaving = false;
export const leaveMenu = () => {
  leaving = true;
};

export function MenuContent({ className, children, onCloseAutoFocus, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal container={uiPortal()}>
      <DropdownMenu.Content
        data-slot="dropdown-menu-content"
        className={cn(
          'z-60 max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100vh-16px))] overflow-auto rounded-sm bg-surface text-foreground shadow-lift outline-none',
          className,
        )}
        sideOffset={6}
        collisionPadding={8}
        align="start"
        {...props}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          // another menu opened by the click that closed this one keeps the focus it took, and so does a view the choice opened
          if (leaving || document.querySelector('[role=menu][data-state=open]')) e.preventDefault();
          leaving = false;
        }}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

const item =
  'flex w-full cursor-pointer items-center rounded-sm bg-transparent px-2 py-1.5 text-left text-sm text-foreground normal-case tracking-normal outline-none data-highlighted:bg-muted data-disabled:cursor-default data-disabled:opacity-50';

export function MenuItem({ asChild, className, children, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item data-slot="dropdown-menu-item" asChild {...props}>
      {asChild ? children : <button type="button" className={cn(item, className)}>{children}</button>}
    </DropdownMenu.Item>
  );
}

export function MenuRadioGroup(props: ComponentProps<typeof DropdownMenu.RadioGroup>) {
  return <DropdownMenu.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem data-slot="dropdown-menu-radio-item" asChild {...props}>
      <button type="button" className={cn(item, 'data-[state=checked]:bg-muted data-[state=checked]:font-semibold', className)}>
        {children as ReactNode}
      </button>
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label data-slot="dropdown-menu-label" className={cn('px-2 pt-1.5 pb-1 text-2xs text-muted-foreground', className)} {...props} />;
}
