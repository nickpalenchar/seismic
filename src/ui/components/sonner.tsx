// Sonner (shadcn/ui's Toaster, on sonner): draws and animates the toast stack and lets the owner swipe
// a toast aside. It is only the stack: what a toast says and when it goes belong to the toast store
// (`toast.tsx`), which hands each toast to Sonner as a custom element that never times out by itself.
// Every toast is `toast.custom`, so the look stays the toast's own (`.toast` in styles.css until W7);
// Sonner brings the enter and exit motion, the stacking above the corner and the swipe. The stack
// stands in `#acks` (see styles.css), above whatever else that column holds.

import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster({ ...props }: ToasterProps) {
  return <Sonner className="toaster" expand visibleToasts={99} gap={6} hotkey={[]} position="bottom-right" toastOptions={{ duration: Infinity }} {...props} />;
}
