




import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffPart } from '../core/diff';
import { api } from './api';
import { LinkButton } from './components/button';
import { CodeBlock, CodeBlockContent, CodeBlockLine, CodeBlockSplitRow } from './components/codeBlock';
import { contextLines, type DiffLine, endsFile, gap, type Hunk, parseHunks, splitLines, splitRows } from './diffLines';
import type { DiffStyle } from './diffStyle';
import { languageOf, loadTokenizer, paintHunks, type Token } from './highlight';
import { t } from './strings';
import { useResolvedTheme } from './theme';


type Whole = { old: string[]; new: string[] } | 'loading' | 'failed' | null;


interface Painted {
  old: Map<number, Token[]>;
  new: Map<number, Token[]>;
  failed?: true;
}


interface For<T> {
  key: string;
  value: T;
}

const NONE: ReadonlySet<number> = new Set();

/**
 * `versions`: the whole old and new text where the caller has them (a diff not of a card's files),
 * so the unchanged lines expand from them without asking the server.
 */
export default function CodeDiff({ part, card, style, versions }: { part: DiffPart; card: string; style: DiffStyle; versions?: { old: string[]; new: string[] } }) {
  
  
  
  const text = useMemo(() => part.lines.join('\n'), [part]);
  const file = part.file;
  const hunks = useMemo(() => parseHunks(text.split('\n')), [text]);
  const changed = part.status === 'modified' || part.status === 'renamed';
  
  const ends = useMemo(() => !changed || endsFile(hunks), [hunks, changed]);
  
  
  const key = `${card}\n${file}\n${text}`;
  
  
  
  const [probe, setProbe] = useState<For<boolean>>();
  const expandable = !!versions || (probe?.key === key && probe.value);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !changed || versions) return;
    let gone = false;
    const look = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        look.disconnect();
        api.hasVersions(card, file).then(
          (ok) => !gone && setProbe({ key, value: ok }),
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
  }, [key, card, file, changed, !!versions]);

  const [wholeFor, setWholeFor] = useState<For<Whole>>();
  const whole = wholeFor?.key === key ? wholeFor.value : null;
  const [shownFor, setShownFor] = useState<For<ReadonlySet<number>>>();
  const shown = shownFor?.key === key ? shownFor.value : NONE;
  const expand = (i: number) => {
    const asked = key;
    setShownFor((s) => ({ key: asked, value: new Set(s?.key === asked ? s.value : NONE).add(i) }));
    if (versions || (whole !== null && whole !== 'failed')) return;
    setWholeFor({ key: asked, value: 'loading' });
    
    const settle = (value: Whole) => setWholeFor((w) => (w?.key === asked ? { key: asked, value } : w));
    api.versions(card, file).then(
      (v) => settle(v && v.old !== null && v.new !== null ? { old: splitLines(v.old), new: splitLines(v.new) } : 'failed'),
      () => settle('failed'),
    );
  };
  const files = versions ?? (typeof whole === 'object' ? whole : null);

  
  
  
  
  const paintFiles = shown.size > 0 ? files : null;
  const theme = useResolvedTheme();
  const [paintedFor, setPaintedFor] = useState<For<Painted>>();
  const painted = paintedFor?.key === key ? paintedFor.value : undefined;
  const paintFailed = !!painted?.failed;
  useEffect(() => {
    let gone = false;
    const setPainted = (value: Painted) => setPaintedFor({ key, value });
    loadTokenizer(languageOf(file), theme).then(
      (tokenize) => {
        if (gone || !tokenize) return;
        const side = (lines: string[], numbers: number[]) => {
          const tokens = tokenize(lines.join('\n'));
          return new Map(numbers.map((n, i) => [n, tokens[i] ?? []]));
        };
        if (paintFiles) {
          setPainted({ old: side(paintFiles.old, paintFiles.old.map((_, i) => i + 1)), new: side(paintFiles.new, paintFiles.new.map((_, i) => i + 1)) });
        } else {
          setPainted(paintHunks(hunks, tokenize));
        }
      },
      () => !gone && setPainted({ old: new Map(), new: new Map(), failed: true }),
    );
    return () => {
      gone = true;
    };
  }, [key, file, hunks, paintFiles, theme]);

  if (!hunks.length) return null;
  const tokensOf = (line: DiffLine) => (line.kind === 'removed' ? painted?.old.get(line.old!) : painted?.new.get(line.new!));
  const digits = String(hunks.reduce((m, h) => Math.max(m, h.oldStart + h.oldCount, h.newStart + h.newCount), files ? files.new.length : 0)).length;
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
                  {line.noEol && <NoEol />}
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
                  {line.noEol && <NoEol />}
          </CodeBlockLine>
        ));

  const rows: ReactNode[] = [];
  for (let i = 0; i <= hunks.length; i++) {
    const hunk: Hunk | undefined = hunks[i];
    const g = gap(hunks, i, files?.new.length);
    if (shown.has(i) && files) for (const row of drawLines(contextLines(files.new, g.from, g.to ?? Infinity, g.shift), `g${i}`)) rows.push(row);
    else {
      
      
      const count = g.to === null ? (ends ? 0 : null) : g.to - g.from;
      const offer = expandable && whole !== 'failed';
      if (count !== 0)
        rows.push(
          <span key={`s${i}`} data-slot="code-block-separator" className="-mx-2.5 flex select-none items-baseline gap-3 bg-muted px-2.5 py-0.5 font-sans text-muted-foreground">
            {offer ? (
              <LinkButton disabled={whole === 'loading'} onClick={() => expand(i)}>
                {whole === 'loading' && shown.has(i) ? t.diff.loadingWhole : count === null ? t.diff.showRest : t.diff.showUnchanged(count)}
              </LinkButton>
            ) : (
              <span>{count === null ? t.diff.restFolded : t.diff.unchanged(count)}</span>
            )}
            {hunk?.section && <span className="min-w-0 truncate font-mono">{hunk.section}</span>}
          </span>,
        );
    }
    if (hunk) for (const row of drawLines(hunk.lines, `h${i}`)) rows.push(row);
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
      <CodeBlock size="sm" className="rounded-t-none rounded-b-xs border-t-0 border-border bg-surface">
        <CodeBlockContent wrap aria-label={part.file} className="group-data-[size=sm]/code-block:py-0">
          {rows}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  );
}

/** Said after a file's last line where no newline follows it. */
function NoEol() {
  return <span data-copy="skip" className="ms-3 select-none font-sans text-muted-foreground">{t.diff.noNewline}</span>;
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
    
    const cuts = [at, ...marks.flatMap((m) => m).filter((c) => c > at && c < end), end];
    for (let k = 0; k < cuts.length - 1; k++) {
      const [from, to] = [cuts[k]!, cuts[k + 1]!];
      const marked = marks.some(([a, b]) => from >= a && to <= b);
      out.push(
        <span
          key={`${from}`}
          style={run.style}
          className={`${marked ? (line.kind === 'removed' ? 'rounded-xs bg-destructive/25' : 'rounded-xs bg-approved/30') : ''}`}
        >
          {line.text.slice(from, to)}
        </span>,
      );
    }
    at = end;
  }
  return out;
}
