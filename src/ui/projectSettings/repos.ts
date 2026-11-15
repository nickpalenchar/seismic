// The project's repositories as the settings sheet edits them: read with their check when it opens,
// each change kept here at once and saved shortly after, on its own repository's entry (`PUT
// /api/c/:project/repos`). A change to where its agents work (worktrees or clones, the clones, slots
// and hosts) restarts the repository's agents: it waits for the owner's word, and the rest saves on.

import { useEffect, useRef, useState } from 'react';
import type { ProjectReposView, RepoConfig } from '../../core/types';
import { api } from '../api';
import { failText } from '../strings';

/** How long after the last change a repository's entry is saved: a word typed is one save, not one per key. */
const SAVE_AFTER_MS = 600;

/** What of a repository's entry restarts its agents when it changes, as it is saved (empty entries left out). */
export function shape(r: RepoConfig): string {
  const workstations = (r.workstations ?? []).map((w) => w.trim()).filter(Boolean);
  const hosts = (r.hosts ?? []).filter((h) => h.name.trim() && h.ssh.trim()).map((h) => ({ ...h, name: h.name.trim(), ssh: h.ssh.trim(), root: h.root.trim() }));
  return JSON.stringify({ workstations, clones: r.clones || 0, slots: r.slots ?? null, hosts, workIn: r.settings?.workstations ?? null });
}

/** `edited` with where its agents work as `saved` has it: what saves without restarting anything. */
export function withPlaceOf(edited: RepoConfig, saved: RepoConfig): RepoConfig {
  const { workstations: _w, clones: _c, slots: _s, hosts: _h, settings, ...rest } = edited;
  const { workstations: _, ...others } = settings ?? {};
  const kept = saved.settings?.workstations ? { ...others, workstations: saved.settings.workstations } : others;
  return {
    ...rest,
    ...(saved.workstations ? { workstations: saved.workstations } : {}),
    ...(saved.clones !== undefined ? { clones: saved.clones } : {}),
    ...(saved.slots !== undefined ? { slots: saved.slots } : {}),
    ...(saved.hosts ? { hosts: saved.hosts } : {}),
    ...(Object.keys(kept).length ? { settings: kept } : {}),
  };
}

export interface ProjectRepos {
  view: ProjectReposView | null;
  /** The repositories as edited here, in the configuration's order. */
  repos: RepoConfig[];
  edit: (i: number, next: RepoConfig) => void;
  /** Whether saving the repository at `i` as edited restarts its agents: it waits for `confirm` or `discard`. */
  restarts: (i: number) => boolean;
  confirm: (i: number) => void;
  discard: (i: number) => void;
  /** Reads them again, with their check: after git was set up, commands were trusted, settings were taken over for everyone. */
  reload: () => void;
  busy: boolean;
  status: string;
}

/** The repositories of `project` while `on`: read afresh each time it opens or what covered it closes (`covered`). */
export function useProjectRepos(project: string, on: boolean, covered: boolean): ProjectRepos {
  const [view, setView] = useState<ProjectReposView | null>(null);
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // the saves outlive renders: what is edited now, what is saved, the saves waiting
  const now = useRef({ repos, view });
  now.current = { repos, view };
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const saved = (i: number) => now.current.view?.project.repos[i];

  const load = () => {
    api.projectRepos(project).then((v) => {
      setView(v);
      setRepos(v.project.repos);
    }, (e) => setStatus(failText(e)));
  };
  useEffect(() => {
    if (!on || covered) return;
    setStatus('');
    load();
  }, [on, covered, project]);

  /** Saves the repository at `i` as edited; `place` with where its agents work, else that as saved. */
  const save = (i: number, place: boolean) => {
    const edited = now.current.repos[i];
    const before = saved(i);
    if (!edited || !before) return;
    const body = place ? edited : withPlaceOf(edited, before);
    if (JSON.stringify(body) === JSON.stringify(before)) return;
    chain.current = chain.current.then(async () => {
      setBusy(true);
      setStatus('');
      try {
        setView(await api.saveProjectRepo(project, body));
      } catch (e) {
        setStatus(failText(e));
      }
      setBusy(false);
    });
  };
  const flush = () => {
    for (const [i, h] of timers.current) {
      clearTimeout(h);
      save(i, false);
    }
    timers.current.clear();
  };
  // closing the sheet, or another project: what waits is saved now
  useEffect(() => {
    if (!on) flush();
    return flush;
  }, [on, project]);

  const restarts = (i: number) => {
    const a = repos[i];
    const b = view?.project.repos[i];
    return !!a && !!b && shape(a) !== shape(b);
  };
  return {
    view,
    repos,
    edit: (i, next) => {
      const list = now.current.repos.map((r, j) => (j === i ? next : r));
      now.current = { ...now.current, repos: list };
      setRepos(list);
      clearTimeout(timers.current.get(i));
      timers.current.set(i, setTimeout(() => {
        timers.current.delete(i);
        save(i, false);
      }, SAVE_AFTER_MS));
    },
    restarts,
    confirm: (i) => {
      clearTimeout(timers.current.get(i));
      timers.current.delete(i);
      save(i, true);
    },
    discard: (i) => {
      const before = saved(i);
      const edited = now.current.repos[i];
      if (before && edited) setRepos(now.current.repos.map((r, j) => (j === i ? withPlaceOf(edited, before) : r)));
    },
    reload: load,
    busy,
    status,
  };
}
