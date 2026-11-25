


import { useEffect, useState } from 'react';
import type { ProjectInfo, ProjectSnapshot, Usage } from '../core/types';
import { useProject } from './api';
import { knowProjects } from './address';
import { when } from './needsYou/renderers';
import { t } from './strings';


const QUIET_MS = 3000;
const UNRESPONSIVE_MS = 150_000;

export function usePhoneProjects(loaded: ProjectInfo[]) {
  const [projects, setProjects] = useState(loaded);
  
  useEffect(() => setProjects(loaded), [loaded]);
  knowProjects(projects);
  const [snaps, setSnaps] = useState<Record<string, ProjectSnapshot>>({});
  const [offline, setOffline] = useState<Record<string, number | null>>({});
  
  const [frozen, setFrozen] = useState<Record<string, boolean>>({});
  
  const [usage, setUsage] = useState<Usage[]>([]);
  const feed = (id: string, live: ReturnType<typeof useProject>) => {
    setUsage(live.usage);
    if (live.snapshot) setSnaps((s) => (s[id] === live.snapshot ? s : { ...s, [id]: live.snapshot! }));
    
    const down = live.offlineSince ?? live.frozenSince;
    setOffline((o) => (o[id] === down ? o : { ...o, [id]: down }));
    const isFrozen = live.offlineSince === null && live.frozenSince !== null;
    setFrozen((f) => (f[id] === isFrozen ? f : { ...f, [id]: isFrozen }));
    if (live.projects) setProjects(live.projects);
  };

  
  const quietSince = Object.values(offline).reduce<number | null>((min, x) => (x === null ? min : min === null ? x : Math.min(min, x)), null);
  const isFrozen = quietSince !== null && Object.keys(offline).some((id) => offline[id] === quietSince && frozen[id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (quietSince === null) return;
    const h = setTimeout(() => tick((n) => n + 1), Math.max(0, quietSince + (isFrozen ? UNRESPONSIVE_MS : QUIET_MS) - Date.now()) + 50);
    return () => clearTimeout(h);
  }, [quietSince, isFrozen]);
  
  const quiet = quietSince !== null && (isFrozen || Date.now() - quietSince >= QUIET_MS);
  const unresponsive = isFrozen && Date.now() - quietSince! >= UNRESPONSIVE_MS;

  const feeds = projects.map((c) => <Feed key={c.id} id={c.id} onChange={feed} />);
  
  const banner = quiet && (
    <div className="ph-quiet sticky top-[60px] z-5 mt-3 py-2.5 px-3 rounded-md bg-foreground text-background flex flex-col gap-0.5 text-sm ph-landscape:top-[50px] ph-landscape:[#ph-home_&]:top-2" role="status">
      <b className="font-semibold text-base">{isFrozen ? (unresponsive ? t.unresponsiveSince(when(quietSince!)) : t.notResponding) : t.phone.notAnswering(when(quietSince!))}</b>
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

