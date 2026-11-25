











import { cn } from 'cn';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { type ComponentProps, type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { useCloseBarMenus } from './menu';
import { uiPortal } from './ui';

export function Popover({ open, onOpenChange, ...props }: ComponentProps<typeof PopoverPrimitive.Root>) {
  useCloseBarMenus(!!open, () => onOpenChange?.(false));
  return <PopoverPrimitive.Root data-slot="popover" open={open} onOpenChange={onOpenChange} {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverContent({ className, align = 'center', sideOffset = 8, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal container={uiPortal()}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-60 box-border max-h-(--radix-popover-content-available-height) w-[min(360px,calc(100vw-16px))] overflow-y-auto rounded-lg border border-glass-edge bg-surface px-3.5 py-2.5 text-left text-sm leading-[1.45] font-normal whitespace-normal text-foreground shadow-lift outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/**
 * A popover that opens while a mouse rests on its trigger as well as by a click: hovering shows it
 * (without taking the focus), leaving the trigger and the panel hides it again after `delay` ms, so a
 * path across the gap between them keeps it; a click or tap on the trigger pins it open until a click
 * elsewhere, Esc or a second click. A finger has no hover: its tap pins. Spread `root` on `Popover`,
 * `hover` on the trigger (or whatever the pointer rests on) and on the panel, `content` on the panel,
 * and `trigger` on a `PopoverTrigger`. A navigation action calls `close({ restoreFocus: false })`
 * before opening its destination so closing the panel does not take focus back from that view.
 */
export function useHoverOpen({ delay = 260, enabled = true }: { delay?: number; enabled?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  
  const wasPinned = useRef(false);
  const restoreOnClose = useRef(true);
  useEffect(() => () => clearTimeout(leave.current), []);
  const show = (on: boolean, pin = false) => {
    clearTimeout(leave.current);
    if (on) restoreOnClose.current = true;
    else wasPinned.current = pinned;
    setOpen(on);
    setPinned(on && pin);
  };
  return {
    open,
    show,
    
    close: ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      show(false);
      restoreOnClose.current = restoreFocus;
    },
    root: { open, onOpenChange: (on: boolean) => show(on, on) },
    hover: {
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' || !enabled) return;
        clearTimeout(leave.current);
        if (!open) show(true);
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' || pinned) return;
        clearTimeout(leave.current);
        leave.current = setTimeout(() => show(false), delay);
      },
    },
    trigger: {
      
      onClick: (e: MouseEvent) => {
        e.preventDefault();
        if (!enabled) return;
        show(!(open && pinned), true);
      },
    },
    content: {
      
      onOpenAutoFocus: (e: Event) => pinned || e.preventDefault(),
      onCloseAutoFocus: (e: Event) => (wasPinned.current && restoreOnClose.current) || e.preventDefault(),
    },
  };
}
