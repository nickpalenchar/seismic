














import { cn } from 'cn';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import { type ComponentProps, type ReactNode, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './button';
import { uiPortal, useOpenerFocus } from './ui';

const layer =
  'fixed inset-0 z-60 flex items-center justify-center bg-scrim p-6 backdrop-blur-[3px] data-[state=open]:animate-[fade_.15s_ease-out]';
const box = 'relative box-border max-h-full max-w-full text-foreground outline-none';

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
  
  const [parked] = useState(() => {
    const el = document.createElement('div');
    el.style.display = 'contents';
    return el;
  });
  
  
  
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
  scrollBody,
  className,
  layerClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
  confirm: { label: ReactNode; onClick: () => void; variant?: ButtonVariant; className?: string; disabled?: boolean; keepOpen?: boolean };
  also?: { label: ReactNode; onClick: () => void; variant?: ButtonVariant; className?: string; disabled?: boolean };
  cancel: ReactNode;
  busy?: boolean;
  
  scrollBody?: boolean;
  className?: string;
  
  layerClassName?: string;
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
        <AlertDialogPrimitive.Overlay data-slot="confirm-layer" className={cn(layer, 'z-70 p-6', layerClassName)}>
          <AlertDialogPrimitive.Content
            data-slot="confirm-dialog"
            {...opener}
            onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
            aria-describedby={undefined}
            className={cn(box, surface.solid, 'w-[min(440px,100%)] rounded-sm p-6 [&_p]:mb-5.5 [&_p]:leading-normal', scrollBody && 'flex flex-col', className)}
          >
            <AlertDialogPrimitive.Title className="m-0 mb-2.5 text-2xl font-semibold">{title}</AlertDialogPrimitive.Title>
            {scrollBody ? (
              <div tabIndex={0} className="min-h-0 overflow-y-auto [overflow-wrap:anywhere] focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring">
                {children}
              </div>
            ) : children}
            <div className="flex shrink-0 flex-wrap gap-2">
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
