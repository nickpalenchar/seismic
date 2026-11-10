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
import { type ComponentProps, type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './button';
import { uiPortal } from './ui';

const layer =
  'fixed inset-0 z-60 flex items-center justify-center bg-dim p-6 backdrop-blur-[3px] data-[state=open]:animate-[fade_.15s_ease-out]';
const box = 'relative box-border max-h-full max-w-full bg-panel text-ink shadow-lift outline-none';

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
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { layerClassName?: string; keepMounted?: boolean }) {
  // the parked children: a detached element they render into for good, moved into the box while it is open
  const [parked] = useState(() => {
    const el = document.createElement('div');
    el.style.display = 'contents';
    return el;
  });
  return (
    <>
      <DialogPrimitive.Portal container={uiPortal()}>
        <DialogPrimitive.Overlay id={id} data-slot="dialog-layer" className={cn(layer, layerClassName)}>
          <DialogPrimitive.Content
            data-slot="dialog-content"
            aria-describedby={undefined}
            className={cn(box, className)}
            {...props}
            onInteractOutside={(e) => {
              onInteractOutside?.(e);
              // a toast or the notification ask stands over the dialog without being part of it: pressing in them does not close it
              if (e.target instanceof Element && e.target.closest('.toast, .notify-ask')) e.preventDefault();
            }}
          >
            {keepMounted ? <div ref={(el) => {
              if (el) el.appendChild(parked);
            }} className="contents" /> : children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
      {keepMounted && createPortal(children, parked)}
    </>
  );
}

/** A confirm: `confirm` runs and closes it, the way back (`cancel`, with the focus) only closes it. Closing by Esc or by `cancel` is `onOpenChange(false)`. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirm,
  cancel,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
  confirm: { label: ReactNode; onClick: () => void; variant?: ButtonVariant; className?: string };
  cancel: ReactNode;
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal container={uiPortal()}>
        <AlertDialogPrimitive.Overlay data-slot="confirm-layer" className={cn(layer, 'z-70 p-6')}>
          <AlertDialogPrimitive.Content
            data-slot="confirm-dialog"
            aria-describedby={undefined}
            className={cn(box, 'w-[min(440px,100%)] rounded-[4px] p-6 [&_p]:mb-[22px] [&_p]:leading-normal', className)}
          >
            <AlertDialogPrimitive.Title className="m-0 mb-2.5 text-2xl font-semibold">{title}</AlertDialogPrimitive.Title>
            {children}
            <div className="flex flex-wrap gap-2">
              <AlertDialogPrimitive.Action asChild>
                <Button variant={confirm.variant ?? 'primary'} className={confirm.className} onClick={confirm.onClick}>
                  {confirm.label}
                </Button>
              </AlertDialogPrimitive.Action>
              <AlertDialogPrimitive.Cancel asChild>
                <Button>{cancel}</Button>
              </AlertDialogPrimitive.Cancel>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
