// Desktop notifications (design: Notifications on the desktop): the project page tells the owner when
// a card starts to wait for them while they are not looking at the page. In the app (Tauri) the
// system's notification comes from the shell, in a browser from the page's own permission. Whether
// it does is the owner's choice (Konfiguration → Benachrichtigungen und Limits), asked once at the first start.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../core/messages';
import { languageOf } from '../core/locale';
import type { ProjectSnapshot, Item } from '../core/types';
import { plainTitle, startedWaiting } from '../core/waits';
import { api } from './api';
import { t } from './strings';

type Tauri = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
const tauri = (): Tauri | undefined => (window as unknown as { __TAURI_INTERNALS__?: Tauri }).__TAURI_INTERNALS__;

/** Whether this page can notify at all: in the app, or where the browser has notifications. */
export const canNotify = () => !!tauri() || 'Notification' in window;

export type Permission = 'granted' | 'denied' | 'default';

export async function permission(): Promise<Permission> {
  const app = tauri();
  if (app) return (await app.invoke('plugin:notification|is_permission_granted')) ? 'granted' : 'default';
  return 'Notification' in window ? Notification.permission : 'denied';
}

export async function requestPermission(): Promise<Permission> {
  const app = tauri();
  if (app) {
    const p = await app.invoke('plugin:notification|request_permission');
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
  }
  return 'Notification' in window ? Notification.requestPermission() : 'denied';
}

/** One notification; `onClick` where the system lets the page know (a browser does, the app's shell does not). */
export async function show(title: string, body: string, onClick?: () => void) {
  const app = tauri();
  if (app) return void (await app.invoke('plugin:notification|notify', { options: { title, body } }));
  const n = new Notification(title, { body });
  n.onclick = () => {
    window.focus();
    onClick?.();
    n.close();
  };
}

/** The owner is looking at the page: in view, in the focused window. */
const attended = () => document.visibilityState === 'visible' && document.hasFocus();

const CHANGED = 'obeya-notifications';
/** Tells the pages of this tab that the setting changed. */
export const notificationsChanged = () => window.dispatchEvent(new Event(CHANGED));

/** The setting, `null` until the owner was asked; follows a change made in the configuration. */
function useSetting(): [boolean | null | undefined, (on: boolean) => Promise<void>] {
  const [on, setOn] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    const load = () => api.notifications().then((v) => setOn(v.on), console.error);
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  const save = useCallback(async (value: boolean) => {
    setOn((await api.saveNotifications(value)).on);
    notificationsChanged();
  }, []);
  return [on, save];
}

/** Notifies when a card of the project starts to wait for the owner and nobody is looking at the page. */
export function useDesktopNotifications(snapshot: ProjectSnapshot, onOpen: (item: Item) => void): { ask: boolean; answer: (on: boolean) => void } {
  const [on, save] = useSetting();
  const seen = useRef<{ project: string; items: Map<string, Item> } | undefined>(undefined);
  const open = useRef(onOpen);
  open.current = onOpen;
  const onRef = useRef(on);
  onRef.current = on;
  const project = snapshot.project;
  useEffect(() => {
    const before = seen.current?.project === project.id ? seen.current.items : undefined;
    seen.current = { project: project.id, items: new Map(snapshot.items.map((i) => [i.id, i])) };
    // what waits as the page opens, or as another project is shown, is not news
    if (!before || onRef.current !== true || attended()) return;
    const started = startedWaiting(before, snapshot.items);
    if (!started.length) return;
    void permission().then((p) => {
      if (p !== 'granted') return;
      const m = MESSAGES[languageOf(document.documentElement.lang) ?? 'de'].push;
      if (started.length > 1) return show(m.several(started.length), started.map((s) => plainTitle(s.item.title)).join(' · '));
      const { item, kind } = started[0] as (typeof started)[number];
      return show(plainTitle(item.title), [m[kind], project.name].filter(Boolean).join(' · '), () => open.current(item));
    });
  }, [snapshot.items, project.id]);
  return {
    ask: on === null && canNotify(),
    answer: (yes) => {
      void (async () => {
        // refused or not granted: the setting says off, and the configuration says why
        const granted = yes && ((await permission()) === 'granted' || (await requestPermission()) === 'granted');
        await save(granted);
      })().catch(console.error);
    },
  };
}

/** The question at the first start. */
export function NotifyAsk({ ask, answer }: { ask: boolean; answer: (on: boolean) => void }) {
  if (!ask) return null;
  const n = t.notifications;
  return (
    <div className="notify-ask" role="dialog" aria-label={n.title}>
      <strong>{n.title}</strong>
      <span>{n.ask}</span>
      <div className="notify-ask-actions">
        <button className="btn primary" onClick={() => answer(true)}>
          {n.turnOn}
        </button>
        <button className="btn" onClick={() => answer(false)}>
          {n.no}
        </button>
      </div>
    </div>
  );
}
