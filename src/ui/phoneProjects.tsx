// Mount the returned feeds once in the phone view, across list/card navigation:
// each project owns one useProject connection. The snapshots, usage, updated project list
// and connection banner come from them without a second set of sockets.
import { useEffect, useState } from 'react';
import type { ProjectInfo, ProjectSnapshot, Usage } from '../core/types';
import { useProject } from './api';
import { knowProjects } from './address';
import { when } from './needsYou/renderers';
import { t } from './strings';

/** A phone returning from its lock screen reconnects within this. */
const QUIET_MS = 3000;
const UNRESPONSIVE_MS = 150_000;

export function usePhoneProjects(loaded: ProjectInfo[]) {
  const [projects, setProjects] = useState(loaded);
  // the projects it last had, while the server did not answer: the list the server sends once it does
  useEffect(() => setProjects(loaded), [loaded]);
  knowProjects(projects);
  const [snaps, setSnaps] = useState<Record<string, ProjectSnapshot>>({});
  const [offline, setOffline] = useState<Record<string, number | null>>({});
  // the projects whose connection is open but answers nothing
  const [frozen, setFrozen] = useState<Record<string, boolean>>({});
  // the plans' usage limits, the same over every project's connection
  const [usage, setUsage] = useState<Usage[]>([]);
  const feed = (id: string, live: ReturnType<typeof useProject>) => {
    setUsage(live.usage);
    if (live.snapshot) setSnaps((s) => (s[id] === live.snapshot ? s : { ...s, [id]: live.snapshot! }));
    // a socket that is open but answers nothing (frozen) counts as not answering, like a lost one
    const down = live.offlineSince ?? live.frozenSince;
    setOffline((o) => (o[id] === down ? o : { ...o, [id]: down }));
    const isFrozen = live.offlineSince === null && live.frozenSince !== null;
    setFrozen((f) => (f[id] === isFrozen ? f : { ...f, [id]: isFrozen }));
    if (live.projects) setProjects(live.projects);
  };

  // ---------------------------------------------------------------- the machine not answering
  const quietSince = Object.values(offline).reduce<number | null>((min, x) => (x === null ? min : min === null ? x : Math.min(min, x)), null);
  const isFrozen = quietSince !== null && Object.keys(offline).some((id) => offline[id] === quietSince && frozen[id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (quietSince === null) return;
    const h = setTimeout(() => tick((n) => n + 1), Math.max(0, quietSince + (isFrozen ? UNRESPONSIVE_MS : QUIET_MS) - Date.now()) + 50);
    return () => clearTimeout(h);
  }, [quietSince, isFrozen]);
  // a frozen server is named at once (its silence was already 10 s); a lost connection after 3 s
  const quiet = quietSince !== null && (isFrozen || Date.now() - quietSince >= QUIET_MS);
  const unresponsive = isFrozen && Date.now() - quietSince! >= UNRESPONSIVE_MS;

  const feeds = projects.map((c) => <Feed key={c.id} id={c.id} onChange={feed} />);
  // stays in view under the bar while the page scrolls; with the phone turned the list's bar scrolls away, so there it sticks at the top
  const banner = quiet && (
    <div className="ph-quiet sticky top-[60px] z-5 mt-3 py-2.5 px-3 rounded-[8px] bg-foreground text-background flex flex-col gap-0.5 text-[13.5px] ph-landscape:top-[50px] ph-landscape:[#ph-home_&]:top-2" role="status">
      <b className="font-semibold text-[14.5px]">{isFrozen ? (unresponsive ? t.unresponsiveSince(when(quietSince!)) : t.notResponding) : t.phone.notAnswering(when(quietSince!))}</b>
      <span>{t.phone.notAnsweringWhy}</span>
    </div>
  );
  return { projects, snaps, usage, feeds, banner };
}

/** One project's live snapshot, handed up as it changes. */
function Feed({ id, onChange }: { id: string; onChange: (id: string, live: ReturnType<typeof useProject>) => void }) {
  const live = useProject(id);
  useEffect(() => onChange(id, live), [live.snapshot, live.offlineSince, live.frozenSince, live.projects, live.usage]);
  return null;
}

