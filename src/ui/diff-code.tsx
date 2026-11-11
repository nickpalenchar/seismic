// A file's diff in shadcn/ui's code block: syntax highlighting, the words that changed marked within a
// line, split or unified, and the unchanged lines around the hunks expandable. It comes from the
// patch, so a diff opens as fast as the patch is there; highlighting follows once its language has
// loaded, and the whole old and new file are fetched only when the owner expands.

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffPart } from '../core/diff';
import { api } from './api';
import { LinkButton } from './components/button';
import { CodeBlock, CodeBlockContent, CodeBlockLine, CodeBlockSplitRow } from './components/code-block';
import { contextLines, type DiffLine, gap, type Hunk, parseHunks, splitLines, splitRows } from './diff-lines';
import type { DiffStyle } from './diffStyle';
import { languageOf, loadTokenizer, type Token } from './highlight';
import { t } from './strings';

/** The whole old and new file, once the owner expanded: `loading` meanwhile, `failed` when they could not be read. */
type Whole = { old: string[]; new: string[] } | 'loading' | 'failed' | null;

/** A line's tokens by its number, on each side. */
interface Painted {
  of: Whole;
  old: Map<number, Token[]>;
  new: Map<number, Token[]>;
}

export default function CodeDiff({ part, card, style }: { part: DiffPart; card: string; style: DiffStyle }) {
  const hunks = useMemo(() => parseHunks(part.lines), [part]);
  const changed = part.status === 'modified' || part.status === 'renamed';
  // A file is offered its unchanged lines once its whole text is known to be there: a probe, as the
  // file comes near the screen, carries no file; the files themselves are fetched when the owner
  // expands. A file whose text cannot be shown keeps its folded lines as a count.
  const [expandable, setExpandable] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !changed) return;
    let gone = false;
    const look = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        look.disconnect();
        api.hasVersions(card, part.file).then(
          (ok) => !gone && setExpandable(ok),
          () => {},
        );
      },
      { rootMargin: '600px' },
    );
    look.observe(el);
    return () => {
      gone = true;
      look.disconnect();
    };
  }, [part, card, changed]);

  const [whole, setWhole] = useState<Whole>(null);
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    setWhole(null);
    setShown(new Set());
  }, [part]);
  const expand = (i: number) => {
    setShown((s) => new Set(s).add(i));
    if (whole !== null && whole !== 'failed') return;
    setWhole('loading');
    api.versions(card, part.file).then(
      (v) => setWhole(v && v.old !== null && v.new !== null ? { old: splitLines(v.old), new: splitLines(v.new) } : 'failed'),
      () => setWhole('failed'),
    );
  };
  const files = typeof whole === 'object' ? whole : null;

  // Highlighting: the hunks' lines on each side until the whole files are there, then the files,
  // so the unchanged lines shown between hunks are coloured too and the grammar runs through.
  const [painted, setPainted] = useState<Painted>();
  const [paintFailed, setPaintFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    loadTokenizer(languageOf(part.file)).then(
      (tokenize) => {
        if (gone || !tokenize) return;
        const side = (lines: string[], numbers: number[]) => {
          const tokens = tokenize(lines.join('\n'));
          return new Map(numbers.map((n, i) => [n, tokens[i] ?? []]));
        };
        if (files) {
          setPainted({ of: files, old: side(files.old, files.old.map((_, i) => i + 1)), new: side(files.new, files.new.map((_, i) => i + 1)) });
        } else {
          const all = hunks.flatMap((h) => h.lines);
          const olds = all.filter((l) => l.old !== undefined && l.kind !== 'added');
          const news = all.filter((l) => l.new !== undefined && l.kind !== 'removed');
          setPainted({ of: null, old: side(olds.map((l) => l.text), olds.map((l) => l.old!)), new: side(news.map((l) => l.text), news.map((l) => l.new!)) });
        }
      },
      () => !gone && setPaintFailed(true),
    );
    return () => {
      gone = true;
    };
  }, [part, hunks, files]);

  if (!hunks.length) return null;
  const tokensOf = (line: DiffLine) => (line.kind === 'removed' ? painted?.old.get(line.old!) : painted?.new.get(line.new!));
  const digits = String(Math.max(...hunks.map((h) => Math.max(h.oldStart + h.oldCount, h.newStart + h.newCount)), files ? files.new.length : 0)).length;
  const number = (n?: number) => (
    <span className="inline-block align-top text-end tabular-nums" style={{ width: `${digits}ch` }}>
      {n ?? ''}
    </span>
  );

  const drawLines = (lines: DiffLine[], key: string): ReactNode[] =>
    style === 'split'
      ? splitRows(lines).map((row, i) => (
          <CodeBlockSplitRow key={`${key}-${i}`}>
            {[row.left, row.right].map((line, side) =>
              line ? (
                <CodeBlockLine key={side} variant={variant(line)} gutter={number(side ? line.new : line.old)}>
                  {paint(line, tokensOf(line))}
                </CodeBlockLine>
              ) : (
                <CodeBlockLine key={side} variant="absent" />
              ),
            )}
          </CodeBlockSplitRow>
        ))
      : lines.map((line, i) => (
          <CodeBlockLine
            key={`${key}-${i}`}
            variant={variant(line)}
            gutter={
              <span className="flex gap-x-2">
                {number(line.old)}
                {number(line.new)}
              </span>
            }
          >
            {paint(line, tokensOf(line))}
          </CodeBlockLine>
        ));

  const rows: ReactNode[] = [];
  for (let i = 0; i <= hunks.length; i++) {
    const hunk: Hunk | undefined = hunks[i];
    const g = gap(hunks, i, files?.new.length);
    if (shown.has(i) && files) rows.push(...drawLines(contextLines(files.new, g.from, g.to ?? Infinity, g.shift), `g${i}`));
    else {
      const count = g.to === null ? null : g.to - g.from;
      const offer = expandable && whole !== 'failed';
      if (count !== 0 && (count !== null || offer))
        rows.push(
          <span key={`s${i}`} data-slot="code-block-separator" className="-mx-2.5 flex select-none items-baseline gap-3 bg-muted px-2.5 py-0.5 font-sans text-muted-foreground">
            {offer ? (
              <LinkButton disabled={whole === 'loading'} onClick={() => expand(i)}>
                {whole === 'loading' && shown.has(i) ? t.diff.loadingWhole : count === null ? t.diff.showRest : t.diff.showUnchanged(count)}
              </LinkButton>
            ) : (
              <span>{t.diff.unchanged(count!)}</span>
            )}
            {hunk?.section && <span className="min-w-0 truncate font-mono">{hunk.section}</span>}
          </span>,
        );
    }
    if (hunk) rows.push(...drawLines(hunk.lines, `h${i}`));
  }

  return (
    <div ref={box}>
      {paintFailed && (
        <p className="hint" role="alert">
          {t.diff.highlightFailed} <LinkButton onClick={() => location.reload()}>{t.diff.reloadHighlight}</LinkButton>
        </p>
      )}
      {whole === 'failed' && (
        <p className="hint" role="alert">
          {t.diff.wholeFailed}
        </p>
      )}
      <CodeBlock size="sm" className="rounded-t-none rounded-b-[2px] border-t-0 border-line bg-panel">
        <CodeBlockContent wrap aria-label={part.file} className="group-data-[size=sm]/code-block:py-0">
          {rows}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  );
}

const variant = (line: DiffLine) => (line.kind === 'context' ? 'default' : line.kind);

/** A line's text in its tokens' colours, the words that changed in it marked. */
function paint(line: DiffLine, tokens?: Token[]): ReactNode[] {
  const runs = tokens && tokens.map((t) => t.content).join('') === line.text ? tokens : [{ content: line.text }];
  const marks = line.marks ?? [];
  const out: ReactNode[] = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.content.length;
    // cut the run where a mark starts or ends inside it
    const cuts = [at, ...marks.flatMap((m) => m).filter((c) => c > at && c < end), end];
    for (let k = 0; k < cuts.length - 1; k++) {
      const [from, to] = [cuts[k]!, cuts[k + 1]!];
      const marked = marks.some(([a, b]) => from >= a && to <= b);
      out.push(
        <span
          key={`${from}`}
          style={run.style}
          className={`${run.style ? 'text-(--shiki-light) dark:text-(--shiki-dark)' : ''} ${marked ? (line.kind === 'removed' ? 'rounded-[2px] bg-error/25' : 'rounded-[2px] bg-approved/30') : ''}`}
        >
          {line.text.slice(from, to)}
        </span>,
      );
    }
    at = end;
  }
  return out;
}
