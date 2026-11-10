// Menus on Radix DropdownMenu: a button that opens a list of actions, links or radio choices, with
// arrow keys, typeahead, Esc and an outside click handled by Radix. Non-modal: the page stays live
// under an open menu, as the hand-built lists did. The list is portaled into `uiPortal()` and closes
// when a shortcut asks the bar's menus to make room (`closeBarMenus`).
//
// `Menu` is the root (`open` and `onOpenChange` to control it), `MenuTrigger` the button (`asChild`
// to use the caller's), `MenuContent` the panel (`className` for its size), `MenuItem` an action
// (a button; `asChild` for a link or a chip), `MenuRadioGroup` and `MenuRadioItem` a choice with the
// current one marked, `MenuLabel` a heading.

import { DropdownMenu } from 'radix-ui';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { uiPortal } from './ui';

/** Make room for another bar interaction opened from a keyboard shortcut. */
export const closeBarMenus = () => dispatchEvent(new Event('obeya:close-bar-menus'));

export function Menu({ open, onOpenChange, ...props }: Omit<ComponentProps<typeof DropdownMenu.Root>, 'modal'>) {
  const latest = useRef(onOpenChange);
  latest.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    const close = () => latest.current?.(false);
    addEventListener('obeya:close-bar-menus', close);
    return () => removeEventListener('obeya:close-bar-menus', close);
  }, [open]);
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={onOpenChange} {...props} />;
}

export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className, children, onCloseAutoFocus, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal container={uiPortal()}>
      <DropdownMenu.Content
        className={className ? `menu ${className}` : 'menu'}
        sideOffset={6}
        collisionPadding={8}
        align="start"
        {...props}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          // another menu opened by the click that closed this one keeps the focus it took
          if (document.querySelector('[role=menu][data-state=open]')) e.preventDefault();
        }}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ asChild, className, children, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item asChild {...props}>
      {asChild ? children : <button type="button" className={className ? `menu-item ${className}` : 'menu-item'}>{children}</button>}
    </DropdownMenu.Item>
  );
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem asChild {...props}>
      <button type="button" className={className ? `menu-item ${className}` : 'menu-item'}>{children as ReactNode}</button>
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={className ? `menu-heading ${className}` : 'menu-heading'} {...props} />;
}
