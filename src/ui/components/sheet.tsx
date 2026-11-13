// Sheet (shadcn/ui's, on Radix Dialog): a panel along the window's edge. `SheetContent` is the modal one
// shadcn brings (overlay, focus trap, a close ✕). `docked` is the sidebar of the right dock (see
// docked.tsx): a non-modal sheet (`modal={false}` on `Sheet`) that the canvas stays usable beside,
// mounted all the time so what it holds survives closing (`forceMount`), standing where it is
// rendered rather than in a portal, its slide, width (`--sheet-w`) and frost's glass its own. Esc, the
// close button and the resize grip stay the dock's: a docked sheet is a complementary region, not a
// dialog, so what Radix would dismiss on (Esc, a press or focus outside) and where it would put the
// focus is left to the dock.

import * as React from "react"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { uiPortal, useOpenerFocus } from "./ui"
import { t } from "../strings"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" container={uiPortal()} {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  docked = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  docked?: boolean
}) {
  const opener = useOpenerFocus()
  if (docked) {
    return (
      <SheetPrimitive.Content
        data-slot="sheet-content"
        role="complementary"
        forceMount
        aria-describedby={undefined}
        onOpenAutoFocus={onOpenAutoFocus ?? ((e) => e.preventDefault())}
        onCloseAutoFocus={onCloseAutoFocus ?? ((e) => e.preventDefault())}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className={cn(
          "fixed inset-y-0 right-0 z-25 w-(--sheet-w,380px) overflow-auto rounded-none border border-r-0 border-glass-edge bg-glass px-[22px] pt-5 pb-[30px] shadow-[inset_0_1px_0_var(--glass-hi),var(--lift)] backdrop-blur-[28px] backdrop-saturate-[1.6]",
          "transition-[transform,width,visibility] duration-[450ms] ease-[cubic-bezier(.3,.9,.3,1)] [transition-property:transform,width,visibility] [transition-delay:0s,0s,.45s]",
          "data-[state=closed]:invisible data-[state=closed]:translate-x-[calc(100%+1px)] data-[state=open]:[transition-delay:0s]",
          className
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    )
  }
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        onOpenAutoFocus={(e) => {
          opener.onOpenAutoFocus()
          onOpenAutoFocus?.(e)
        }}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e)
          opener.onCloseAutoFocus(e)
        }}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
            <XIcon className="size-4" />
            <span className="sr-only">{t.close}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
