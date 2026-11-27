






import { cn } from 'cn';
import { Check } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { GitFolder, GithubRepoList, GithubRepoView } from '../core/types';
import { api } from './api';
import { Button } from './components/button';
import { Callout, CalloutDescription } from './components/callout';
import { CheckLabel } from './components/checkLabel';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './components/command';
import { ConfirmDialog } from './components/dialog';
import { Input } from './components/input';
import { RadioGroup, RadioOption } from './components/radio';
import { Switch } from './components/switch';
import * as K from './configClasses';
import { pathClass } from './setupClasses';
import { failText, t } from './strings';


const PICKED_KEY = 'seismic-site-github-repo';
const FOLDER_KEY = 'seismic-site-github-folder';
const NAME_KEY = 'seismic-site-github-name';
const PRIVATE_KEY = 'seismic-site-github-private';

export const CREATE = '+';

const linkClass = 'text-primary underline decoration-1 underline-offset-[.18em]';

/** A folder as typed, as it is kept: without slashes at either end. */
const tidy = (folder: string) => folder.trim().replace(/^\/+|\/+$/g, '');
const folderOk = (folder: string) => /^[A-Za-z0-9-][A-Za-z0-9._-]{0,80}(\/[A-Za-z0-9-][A-Za-z0-9._-]{0,80}){0,5}$/.test(folder) && !folder.split('/').includes('..');


const SIZE_WARNING = 800 * 1000 * 1000;


let reposNow: GithubRepoList | null = null;

export type GithubAdd = { create: { name: string; private: boolean } } | { repo: string; folder: string; via: 'pr' | 'push' };

/**
 * The GitHub part of adding a site: the repository list, and below it what the choice needs (a
 * name and the public/private switch; a folder, its address and "Initialize demo site").
 */
export function GithubSetup({ running, onAdd, cancel }: { running: boolean; onAdd: (how: GithubAdd) => void;  cancel?: ReactNode }) {
  const g = t.config.sites.github;
  const p = t.config.sites;
  const [list, setList] = useState<GithubRepoList | null>(reposNow);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(() => sessionStorage.getItem(PICKED_KEY) ?? '');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState(() => sessionStorage.getItem(FOLDER_KEY) ?? 'docs/demos');
  const [name, setName] = useState(() => sessionStorage.getItem(NAME_KEY) ?? 'seismic-demos');
  const [priv, setPriv] = useState(() => sessionStorage.getItem(PRIVATE_KEY) === '1');
  const [confirming, setConfirming] = useState(false);
  const [confirmBranch, setConfirmBranch] = useState('');
  useEffect(() => sessionStorage.setItem(PICKED_KEY, picked), [picked]);
  useEffect(() => sessionStorage.setItem(FOLDER_KEY, folder), [folder]);
  useEffect(() => sessionStorage.setItem(NAME_KEY, name), [name]);
  useEffect(() => sessionStorage.setItem(PRIVATE_KEY, priv ? '1' : ''), [priv]);
  useEffect(() => {
    api.githubRepos().then(
      (l) => {
        reposNow = l;
        setList(l);
      },
      (e) => setError(failText(e, { detail: ['invalid'] })),
    );
  }, []);
  const typed = tidy(folder);
  const existing = picked && picked !== CREATE ? picked : '';
  const [info, recheck] = useRepoView(existing && folderOk(typed) ? existing : '', typed);
  const owners = [...new Set((list?.repos ?? []).map((r) => r.owner))];
  const q = query.trim().toLowerCase();
  const shown = (list?.repos ?? []).filter((r) => !q || r.repo.toLowerCase().includes(q));
  const view = info && info !== 'loading' && typeof info !== 'string' ? info : null;
  return (
    <div className="grid gap-2">
      <Command shouldFilter={false} label={p.hosts.github} className="rounded-lg border border-border bg-card">
        <CommandInput aria-label={g.search} placeholder={g.search} value={query} onValueChange={setQuery} wrapperClassName="border-b border-border" className="border-0 shadow-none rounded-b-none" />
        <CommandList className="max-h-[min(360px,40vh)] p-1">
          <CommandItem value={CREATE} className={cn('px-2.5 py-1.5 text-primary', picked === CREATE && 'font-semibold')} onSelect={() => setPicked(CREATE)}>
            {g.create}
            {picked === CREATE && <Check size={14} className="ml-auto" aria-hidden />}
          </CommandItem>
          {!list && !error && <p className="hint px-2.5 py-1.5 m-0">{g.loading}</p>}
          {list && !shown.length && <CommandEmpty>{g.noRepos}</CommandEmpty>}
          {owners.map((owner) => {
            const repos = shown.filter((r) => r.owner === owner);
            return repos.length ? (
              <CommandGroup key={owner} heading={owner}>
                {repos.map((r) => (
                  <CommandItem key={r.repo} value={r.repo} className={cn('px-2.5 py-1.5', picked === r.repo && 'font-semibold')} onSelect={() => setPicked(r.repo)}>
                    <span>
                      {r.repo} <span className="text-muted-foreground font-normal">· {g.visibility(r.private)}</span>
                    </span>
                    {picked === r.repo && <Check size={14} className="ml-auto" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null;
          })}
        </CommandList>
      </Command>
      {error && <p className="p-error m-0">{error}</p>}
      {!picked && cancel && <div className={K.cfgPersonalActionsClass}>{cancel}</div>}
      {picked === CREATE && (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className={K.cfgSubHintClass}>{g.name}</span>
            <Input className={pathClass} aria-label={g.name} spellCheck={false} value={name} disabled={running} onChange={(e) => setName(e.target.value)} />
          </label>
          <CheckLabel>
            <Switch checked={priv} disabled={running} onCheckedChange={setPriv} />
            {g.private}
          </CheckLabel>
          <p className="hint m-0">{priv ? g.privateNote : g.publicNote}</p>
          {priv && <p className="hint m-0">{p.unlistedNote}</p>}
          <div className={K.cfgPersonalActionsClass}>
            <Button variant="primary" disabled={running || !name.trim()} onClick={() => onAdd({ create: { name: name.trim(), private: priv } })}>
              {running ? p.adding : g.createGo}
            </Button>
            {cancel}
          </div>
        </div>
      )}
      {existing && (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className={K.cfgSubHintClass}>{g.folder}</span>
            <Input className={pathClass} aria-label={g.folder} placeholder={g.folderPlaceholder} spellCheck={false} value={folder} disabled={running} onChange={(e) => setFolder(e.target.value)} />
          </label>
          {!folderOk(typed) && <p className="p-error m-0">{g.folderBad}</p>}
          {info === 'loading' && <p className="hint m-0">{g.reading}</p>}
          {typeof info === 'string' && info !== 'loading' && <p className="p-error m-0">{info}</p>}
          {view && (
            <>
              {view.address ? (
                <p className="m-0 text-sm">
                  {g.address}{' '}
                  <a className={linkClass} href={`${view.address}/`} target="_blank" rel="noreferrer">
                    {view.address.replace(/^https?:\/\//, '')}/
                  </a>
                </p>
              ) : (
                <p className="p-error m-0">
                  {g.outside} {view.outside}
                </p>
              )}
              {!view.pages && <p className="hint m-0">{g.pagesOff(view.branch)}</p>}
              {view.pages?.workflow && <p className="hint m-0">{g.workflow}</p>}
              {view.private && <p className="hint m-0">{g.unlistedPrivate}</p>}
              <RepoSize size={view.size} />
              <div className={K.cfgPersonalActionsClass}>
                <Button
                  variant="primary"
                  disabled={running || !view.address}
                  onClick={() => {
                    
                    setConfirmBranch(view.branch);
                    recheck();
                    setConfirming(true);
                  }}
                >
                  {running ? g.initializing : g.init}
                </Button>
                {cancel}
              </div>
            </>
          )}
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={g.confirmTitle}
            confirm={{ label: g.viaPr, disabled: !view?.address, onClick: () => onAdd({ repo: existing, folder: typed, via: 'pr' }) }}
            also={{ label: g.viaPush(view?.branch ?? confirmBranch), variant: 'review-warning', disabled: !view?.push.allowed || !view.address, onClick: () => onAdd({ repo: existing, folder: typed, via: 'push' }) }}
            cancel={g.back}
          >
            {info === 'loading' && <p>{g.checking}</p>}
            {typeof info === 'string' && info !== 'loading' && <p className="p-error">{info}</p>}
            <p>{g.confirmText(existing, typed)}</p>
            {view && !view.push.allowed && <PushCallout repo={existing} branch={view.branch} check={view.push} className="mb-6" />}
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}

/**
 * A repository as GitHub has it for a folder, read afresh when the repository or folder changes,
 * when `recheck` asks, and when the window comes back into focus (a rule changed at GitHub shows):
 * the view, 'loading' during every check, or why it could not be read.
 */
function useRepoView(repo: string, folder: string): [GithubRepoView | 'loading' | string | null, () => void] {
  const [info, setInfo] = useState<GithubRepoView | 'loading' | string | null>(null);
  const [round, setRound] = useState(0);
  const input = `${repo}\n${folder}`;
  const [checkedInput, setCheckedInput] = useState('');
  const asked = useRef(0);
  useEffect(() => {
    const n = ++asked.current;
    setCheckedInput(input);
    if (!repo) return setInfo(null);
    setInfo('loading');
    const at = setTimeout(
      () =>
        api.githubRepo(repo, folder).then(
          (v) => n === asked.current && setInfo(v),
          (e) => n === asked.current && setInfo(failText(e, { detail: ['invalid'] })),
        ),
      round ? 0 : 350,
    );
    return () => {
      clearTimeout(at);
      ++asked.current;
    };
  }, [repo, folder, round]);
  useEffect(() => {
    if (!repo) return;
    const again = () => {
      ++asked.current;
      setInfo('loading');
      setRound((r) => r + 1);
    };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [repo]);
  return [checkedInput === input ? info : repo ? 'loading' : null, () => {
    ++asked.current;
    setInfo('loading');
    setRound((r) => r + 1);
  }];
}

/** "We recommend allowing push to <branch>": where at GitHub to allow it, or whom to ask. */
function PushCallout({ repo, branch, check, className }: { repo: string; branch: string; check: GithubRepoView['push']; className?: string }) {
  const g = t.config.sites.github;
  return (
    <Callout kind="warn" className={cn('push-callout', className)}>
      <CalloutDescription>
        <div>{g.recommend(branch)}</div>
        {check.admin && check.settings ? (
          <a className={cn(linkClass, 'mt-1.5 inline-block')} href={check.settings} target="_blank" rel="noreferrer">
            {g.configure}
          </a>
        ) : (
          <div className="mt-1.5">{g.askAdmin(repo)}</div>
        )}
      </CalloutDescription>
    </Callout>
  );
}

/** The repository's size, with the warning near GitHub's limits. */
function RepoSize({ size }: { size: number }) {
  const g = t.config.sites.github;
  return (
    <>
      {size >= SIZE_WARNING && (
        <Callout kind="warn">
          <CalloutDescription>{g.sizeWarning}</CalloutDescription>
        </Callout>
      )}
      <p className="hint m-0">{g.size((size / 1000 / 1000).toFixed(size < 10_000_000 ? 1 : 0))}</p>
    </>
  );
}

/**
 * "Publish demos" of a site in a repository's folder: straight to the default branch (offered
 * where a push goes through, checked afresh whenever it shows) or as the rolling pull request. A
 * choice takes effect at once. Under it the repository's size.
 */
export function PublishMode({ url, repo, git, onChanged, title = true }: { url: string; repo: string; git: GitFolder; onChanged: (v: Awaited<ReturnType<typeof api.demoSiteMode>>) => void; title?: boolean }) {
  const g = t.config.sites.github;
  const [info, recheck] = useRepoView(repo, git.folder);
  const [status, setStatus] = useState('');
  useEffect(() => recheck(), [url]);
  const view = info && info !== 'loading' && typeof info !== 'string' ? info : null;
  const blocked = !!view && !view.push.allowed;
  
  const branch = view?.branch ?? git.branch;
  const choose = async (mode: string) => {
    if (mode !== 'direct' && mode !== 'pr') return;
    setStatus('');
    try {
      onChanged(await api.demoSiteMode(url, mode));
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <div className="publish-mode grid gap-1.5 my-1.5">
      {title && <span className="text-sm font-semibold">{g.modeTitle}</span>}
      <RadioGroup label={g.modeTitle} value={git.mode} onValueChange={(m) => void choose(m)} className="grid gap-1">
        <RadioOption value="direct" disabled={!view || blocked}>
          {g.direct(branch)}
        </RadioOption>
        <RadioOption value="pr">{g.pr}</RadioOption>
      </RadioGroup>
      {git.mode === 'pr' && <p className="hint m-0">{g.prHint}</p>}
      {info === 'loading' && <p className="hint m-0">{g.checking}</p>}
      {typeof info === 'string' && info !== 'loading' && <p className="p-error m-0">{info}</p>}
      {view && blocked && <PushCallout repo={repo} branch={branch} check={view.push} />}
      {view && !view.address && (
        <p className="p-error m-0">
          {g.outside} {view.outside}
        </p>
      )}
      {view && <RepoSize size={view.size} />}
      {status && <p className="p-error m-0">{status}</p>}
    </div>
  );
}
