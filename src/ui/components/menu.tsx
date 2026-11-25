













import { cn } from 'cn';
import { DropdownMenu } from 'radix-ui';
import { Check } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { uiPortal } from './ui';

/** Make room for another bar interaction opened from a keyboard shortcut. */
export const closeBarMenus = () => dispatchEvent(new Event('seismic:close-bar-menus'));

/** While `open`, `close` when a shortcut asks the bar's menus to make room; menus and popovers take it. */
export function useCloseBarMenus(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const dismiss = () => latest.current();
    addEventListener('seismic:close-bar-menus', dismiss);
    return () => removeEventListener('seismic:close-bar-menus', dismiss);
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

export function MenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem data-slot="dropdown-menu-checkbox-item" asChild {...props}>
      <button type="button" className={cn(item, 'gap-2 pl-7 relative', className)}>
        <DropdownMenu.ItemIndicator className="absolute left-2 inline-flex">
          <Check size={14} strokeWidth={2.5} aria-hidden />
        </DropdownMenu.ItemIndicator>
        {children as ReactNode}
      </button>
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label data-slot="dropdown-menu-label" className={cn('px-2 pt-1.5 pb-1 text-2xs text-muted-foreground', className)} {...props} />;
}

/** A thin rule between groups of entries. */
export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
