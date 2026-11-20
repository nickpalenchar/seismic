// Dialogs (shadcn/ui's Dialog and AlertDialog, on Radix Dialog and AlertDialog): a box over the dimmed
// page that takes the focus, traps Tab, closes on Esc and on a press on the dim around it (an alert
// dialog does not: it is answered), and hands the focus back when it closes. The layer is portaled
// into `uiPortal()` so the theme applies, and `layerOpen` finds it so App's Esc handler leaves the
// key alone.
//
// `Dialog` is the root (`open` and `onOpenChange`), `DialogContent` the box with the dim around it as
// its layer (`id` names that layer for the stylesheet and lookups; `className` is the box's, which
// sets its size, `layerClassName` places it: centred by default), `DialogTitle` and
// `DialogDescription` the heading and text screen readers announce. `keepMounted` on a dialog whose
// inside holds state that must survive closing (a configuration under edit, a form half written):
// its children stay mounted, parked out of sight while it is closed, and move into the box each time
// it opens. `ConfirmDialog` is the one confirm: a title, a text, the confirming button and the way
// back, which has the focus.

import { cn } from 'cn';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import { type ComponentProps, type ReactNode, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './button';
import { uiPortal, useOpenerFocus } from './ui';

const layer =
  'fixed inset-0 z-60 flex items-center justify-center bg-scrim p-6 backdrop-blur-[3px] data-[state=open]:animate-[fade_.15s_ease-out]';
const box = 'relative box-border max-h-full max-w-full text-foreground outline-none';
/** The box's surface: solid, or (`glass`) frost's pane, the page blurred behind it. */
const surface = { solid: 'bg-surface shadow-lift', glass: 'frost-pane' };

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />;
}

export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" {...props} />;
}

export function DialogContent({
  id,
  className,
  layerClassName,
  keepMounted,
  children,
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  glass,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { layerClassName?: string; keepMounted?: boolean; glass?: boolean }) {
  const opener = useOpenerFocus();
  // the parked children: a detached element they render into for good, moved into the box while it is open
  const [parked] = useState(() => {
    const el = document.createElement('div');
    el.style.display = 'contents';
    return el;
  });
  // Reattaching an already mounted subtree makes the browser reset its scroll and focus.
  // Keep the ref stable across updates (including late API responses); only a newly opened
  // dialog needs to move the parked children into its new host.
  const mountParked = useCallback((el: HTMLDivElement | null) => {
    if (el && parked.parentNode !== el) el.appendChild(parked);
  }, [parked]);
  return (
    <>
      <DialogPrimitive.Portal container={uiPortal()}>
        <DialogPrimitive.Overlay id={id} data-slot="dialog-layer" className={cn(layer, layerClassName)}>
          <DialogPrimitive.Content
            data-slot="dialog-content"
            aria-describedby={undefined}
            className={cn(box, glass ? surface.glass : surface.solid, className)}
            {...props}
            onOpenAutoFocus={(e) => {
              opener.onOpenAutoFocus();
              onOpenAutoFocus?.(e);
              // the box itself takes the focus, not its first button: that one would open its tooltip, which would take the first Esc
              if (e.defaultPrevented) return;
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
            }}
            onCloseAutoFocus={(e) => {
              onCloseAutoFocus?.(e);
              opener.onCloseAutoFocus(e);
            }}
            onInteractOutside={(e) => {
              onInteractOutside?.(e);
              // a toast or the notification ask stands over the dialog without being part of it: pressing in them does not close it
              if (e.target instanceof Element && e.target.closest('.toast, .notify-ask')) e.preventDefault();
            }}
          >
            {keepMounted ? <div ref={mountParked} className="contents" /> : children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
      {keepMounted && createPortal(children, parked)}
    </>
  );
}

/**
 * A confirm: `confirm` runs and closes it, the way back (`cancel`, with the focus) only closes it. Closing by Esc or by `cancel` is `onOpenChange(false)`.
 * `keepOpen` lets the primary action close the dialog itself, for example after a save succeeds.
 * `busy` prevents further actions and dismissal while a request is pending.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirm,
  also,
  cancel,
  busy,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
  confirm: { label: ReactNode; onClick: () => void; variant?: ButtonVariant; className?: string; disabled?: boolean; keepOpen?: boolean };
  also?: { label: ReactNode; onClick: () => void; variant?: ButtonVariant; className?: string; disabled?: boolean };
  cancel: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const opener = useOpenerFocus();
  const action = (
    <Button variant={confirm.variant ?? 'primary'} className={confirm.className} disabled={busy || confirm.disabled} onClick={confirm.onClick}>
      {confirm.label}
    </Button>
  );
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal container={uiPortal()}>
        <AlertDialogPrimitive.Overlay data-slot="confirm-layer" className={cn(layer, 'z-70 p-6')}>
          <AlertDialogPrimitive.Content
            data-slot="confirm-dialog"
            {...opener}
            onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
            aria-describedby={undefined}
            className={cn(box, surface.solid, 'w-[min(440px,100%)] rounded-sm p-6 [&_p]:mb-5.5 [&_p]:leading-normal', className)}
          >
            <AlertDialogPrimitive.Title className="m-0 mb-2.5 text-2xl font-semibold">{title}</AlertDialogPrimitive.Title>
            {children}
            <div className="flex flex-wrap gap-2">
              {confirm.keepOpen ? action : <AlertDialogPrimitive.Action asChild>{action}</AlertDialogPrimitive.Action>}
              {also && (
                <AlertDialogPrimitive.Action asChild>
                  <Button variant={also.variant ?? 'default'} className={also.className} disabled={busy || also.disabled} onClick={also.onClick}>
                    {also.label}
                  </Button>
                </AlertDialogPrimitive.Action>
              )}
              <AlertDialogPrimitive.Cancel asChild>
                <Button disabled={busy}>{cancel}</Button>
              </AlertDialogPrimitive.Cancel>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
