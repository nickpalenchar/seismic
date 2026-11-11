// Sonner (shadcn/ui's Toaster, on sonner): draws and animates the toast stack and lets the owner swipe
// a toast aside. It is only the stack: what a toast says and when it goes belong to the toast store
// (`toast.tsx`), which hands each toast to Sonner as a custom element that never times out by itself.
// Every toast is `toast.custom`, so the look stays the toast's own (`ToastLine`); Sonner brings the
// enter and exit motion, the stacking above the corner and the swipe. The stack stands in `#acks`
// (`acksClass`), above whatever else that column holds.

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * The stack's place, over Sonner's own (a stylesheet it injects unlayered, hence `!`): its bottom edge
 * on the top of the column in `#acks`; a toast as wide as its words at the right, on the phone (`phone`)
 * across the column, its words centred.
 */
const stack = {
  desktop: 'absolute! top-auto! bottom-[calc(100%+6px)]! left-auto! right-0! w-0! transform-none!',
  phone: 'absolute! top-auto! bottom-[calc(100%+6px)]! left-0! right-0! w-auto! transform-none!',
};
const toast = {
  desktop: 'w-max! max-w-[inherit]! left-auto! right-0! pointer-events-none!',
  phone: 'w-full! max-w-[inherit]! left-0! right-0! pointer-events-none!',
};
const centred = 'flex justify-center w-full';

export function Toaster({ phone = false, ...props }: ToasterProps & { phone?: boolean }) {
  const at = phone ? 'phone' : 'desktop';
  return (
    <Sonner
      className={`toaster ${stack[at]}`}
      expand
      visibleToasts={99}
      gap={6}
      hotkey={[]}
      position="bottom-right"
      toastOptions={{ duration: Infinity, className: toast[at], ...(phone ? { classNames: { content: centred, title: centred } } : {}) }}
      {...props}
    />
  );
}
