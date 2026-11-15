// The project's repositories as the settings sheet edits them: read with their check when it opens,
// each change kept here at once and saved shortly after, on its own repository's entry (`PUT
// /api/c/:project/repos`). A change to where its agents work (worktrees or clones, the clones, slots
// and hosts) restarts the repository's agents: it waits for the owner's word, and the rest saves on.

import { useEffect, useRef, useState } from 'react';
import type { ProjectReposView, RepoConfig } from '../../core/types';
import { api } from '../api';
import { failText, t } from '../strings';

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
  /** Whether the repository at `i` holds an edit not saved yet: waiting for its save, being saved, refused, or waiting to restart agents. */
  unsaved: (i: number) => boolean;
  /**
   * Saves what waits for the repository at `i` now and says whether it is saved as shown, for what
   * reads the saved configuration ("For everyone", "Update with agent"); a change that restarts its
   * agents is not saved by it, and says so.
   */
  settle: (i: number) => Promise<boolean>;
  /** A save that was refused, to try again. */
  failed: { status: string; retry: () => void } | null;
  busy: boolean;
  status: string;
}

/** The repositories of `project` while `on`: read afresh each time it opens or what covered it closes (`covered`). */
export function useProjectRepos(project: string, on: boolean, covered: boolean): ProjectRepos {
  const [view, setView] = useState<ProjectReposView | null>(null);
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  // the edits not saved yet, by repository path: they stay across a reading afresh, and a refused save keeps them
  const [edited, setEdited] = useState<Map<string, RepoConfig>>(new Map());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState<{ path: string; status: string } | null>(null);
  // the saves outlive renders: what is edited now, what is saved, the saves waiting
  const now = useRef({ repos, view, edited });
  now.current = { repos, view, edited };
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const savedAt = (path: string) => now.current.view?.project.repos.find((r) => r.path === path);
  const editedAt = (path: string) => now.current.repos.find((r) => r.path === path);
  const keepEdited = (next: Map<string, RepoConfig>) => {
    now.current = { ...now.current, edited: next };
    setEdited(next);
  };

  const load = () => {
    api.projectRepos(project).then((v) => {
      setView(v);
      // an edit not saved yet stays over what is read: the owner still sees, and can save or discard, what they changed
      const list = v.project.repos.map((r) => now.current.edited.get(r.path) ?? r);
      now.current = { ...now.current, view: v, repos: list };
      setRepos(list);
    }, (e) => setStatus(failText(e)));
  };
  useEffect(() => {
    if (!on || covered) return;
    setStatus('');
    load();
  }, [on, covered, project]);
  // another project: its own repositories, none of this one's edits
  useEffect(() => {
    keepEdited(new Map());
    setFailed(null);
  }, [project]);

  /** Saves the repository at `path` as edited; `place` with where its agents work, else that as saved. Says whether it is saved as shown. */
  const save = (path: string, place: boolean): Promise<boolean> => {
    const run = chain.current.then(async () => {
      const edit = editedAt(path);
      const before = savedAt(path);
      if (!edit || !before) return false;
      const body = place ? edit : withPlaceOf(edit, before);
      const whole = JSON.stringify(body) === JSON.stringify(edit);
      // nothing left to save (changed back to what is saved): a refusal before is over too
      if (JSON.stringify(body) === JSON.stringify(before)) {
        setFailed((f) => (f?.path === path ? null : f));
        if (whole) forget(path, edit);
        return whole;
      }
      setBusy(true);
      setStatus('');
      try {
        const v = await api.saveProjectRepo(project, body);
        now.current = { ...now.current, view: v };
        setView(v);
        setFailed((f) => (f?.path === path ? null : f));
        // saved as it is still shown, place included: nothing of it waits any more
        if (whole) forget(path, edit);
        return whole;
      } catch (e) {
        // the edit stays, shown as not saved, with a way to try again
        setFailed({ path, status: failText(e, { detail: ['config', 'invalid'] }) });
        return false;
      } finally {
        setBusy(false);
      }
    });
    chain.current = run.catch(() => {});
    return run;
  };
  /** The edit of `path` is saved: it no longer waits, unless the owner changed it again meanwhile. */
  const forget = (path: string, saved: RepoConfig) => {
    if (editedAt(path) !== saved || !now.current.edited.has(path)) return;
    const next = new Map(now.current.edited);
    next.delete(path);
    keepEdited(next);
  };
  const flush = () => {
    for (const [path, h] of timers.current) {
      clearTimeout(h);
      void save(path, false);
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
    const b = a && view?.project.repos.find((r) => r.path === a.path);
    return !!a && !!b && shape(a) !== shape(b);
  };
  const pathOf = (i: number) => now.current.repos[i]?.path;
  return {
    view,
    repos,
    edit: (i, next) => {
      const list = now.current.repos.map((r, j) => (j === i ? next : r));
      now.current = { ...now.current, repos: list };
      setRepos(list);
      keepEdited(new Map(now.current.edited).set(next.path, next));
      clearTimeout(timers.current.get(next.path));
      timers.current.set(next.path, setTimeout(() => {
        timers.current.delete(next.path);
        void save(next.path, false);
      }, SAVE_AFTER_MS));
    },
    restarts,
    confirm: (i) => {
      const path = pathOf(i);
      if (!path) return;
      clearTimeout(timers.current.get(path));
      timers.current.delete(path);
      void save(path, true);
    },
    discard: (i) => {
      const path = pathOf(i);
      const before = path && savedAt(path);
      const edit = path && editedAt(path);
      if (!path || !before || !edit) return;
      const back = withPlaceOf(edit, before);
      const list = now.current.repos.map((r) => (r.path === path ? back : r));
      now.current = { ...now.current, repos: list };
      setRepos(list);
      const next = new Map(now.current.edited);
      if (JSON.stringify(back) === JSON.stringify(before)) next.delete(path);
      else next.set(path, back);
      keepEdited(next);
    },
    reload: load,
    unsaved: (i) => {
      const path = repos[i]?.path;
      return !!path && edited.has(path);
    },
    settle: async (i) => {
      const path = pathOf(i);
      if (!path) return false;
      clearTimeout(timers.current.get(path));
      timers.current.delete(path);
      const done = (await save(path, false)) || !now.current.edited.has(path);
      // what is left waits for "Save and restart agents"; a refused save says why itself
      if (!done && savedAt(path) && editedAt(path) && shape(editedAt(path)!) !== shape(savedAt(path)!)) setStatus(t.projectSettings.restartFirst);
      return done;
    },
    failed: failed && { status: failed.status, retry: () => void save(failed.path, false) },
    busy,
    status,
  };
}
