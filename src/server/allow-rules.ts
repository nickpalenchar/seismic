// A repository's allow list (`permissions.allow` of its `.claude/settings.json`, as the owner
// confirmed it in "Configuration") applied to a harness that has no such list of its own: Claude
// Code checks it itself, a Codex worker asks the owner for each command its sandbox does not
// cover. A command counts only when it is plain: one program with arguments, none of the shell's
// own syntax, so that a rule for `bun test *` never lets `bun test x; rm -rf y` through. In front
// of covered commands, preparing the shell needs no rule of its own (`setup`): `source` of a file
// the agent cannot change, `nvm use`.

import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';

/** The patterns of the `Bash(...)` rules of a `.claude/settings.json` text; none where it does not read. */
export function bashRules(settingsText: string): string[] {
  try {
    const allow = (JSON.parse(settingsText) as { permissions?: { allow?: unknown } })?.permissions?.allow;
    if (!Array.isArray(allow)) return [];
    return allow.flatMap((r) => (typeof r === 'string' ? [/^Bash\((.*)\)$/s.exec(r)?.[1]] : [])).filter((p): p is string => !!p?.trim());
  } catch {
    return [];
  }
}

/** The rule's words as a Codex prefix, or null where a `*` stands for part of a word. */
export function prefixOf(rule: string): string[] | null {
  const words = rule.trim().replace(/:\*$/, ' *').split(/\s+/);
  if (words.at(-1) === '*') words.pop();
  return words.length && !words.some((w) => w.includes('*')) ? words : null;
}

/**
 * The Codex rules file (`.codex/rules/*.rules`) for the allow list of a `.claude/settings.json`
 * text, and the rules that have no form there: a Codex rule is a literal word prefix. `by` names
 * how the file is made again, for its header.
 */
export function codexRules(settingsText: string, by: string): { file: string; skipped: string[] } {
  const lines: string[] = [];
  const skipped: string[] = [];
  for (const rule of bashRules(settingsText)) {
    const prefix = prefixOf(rule);
    const line = prefix && `prefix_rule(pattern=${JSON.stringify(prefix)}, decision="allow")`;
    // `bun test` and `bun test *` are one prefix
    if (line) lines.includes(line) || lines.push(line);
    else skipped.push(rule);
  }
  const header = [
    `# Generated from .claude/settings.json by ${by}; edit that file, not this one.`,
    '# A Codex rule is a word prefix: a Claude rule without a `*` (an exact command) allows arguments after it here.',
    '# Rules whose `*` stands inside a word have no form here; Seismic applies them itself to its Codex workers:',
    ...skipped.map((r) => `#   Bash(${r})`),
    '',
  ];
  return { file: [...header, ...lines, ''].join('\n'), skipped };
}

/** The words of `text` as a POSIX shell reads them between plain single and double quotes; null for any other shell syntax. */
function words(text: string): string[] | null {
  const out: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? '') + text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      let part = '';
      for (; j < text.length && text[j] !== '"'; j++) {
        // in double quotes a backslash only escapes `"`, `\\`, `$` and the backtick; the escaped character is the text's own
        if (text[j] === '\\') {
          const next = text[j + 1];
          if (next === undefined || !'"\\$`'.includes(next)) return null;
          part += next;
          j++;
          continue;
        }
        if (text[j] === '$' || text[j] === '`') return null;
        part += text[j];
      }
      if (j >= text.length) return null;
      word = (word ?? '') + part;
      i = j;
    } else if (c === ' ' || c === '\t') {
      if (word !== null) out.push(word);
      word = null;
    } else if (c === '~' && word === null && text[i + 1] === '/') word = homedir();
    else word = (word ?? '') + c;
  }
  if (word !== null) out.push(word);
  return out;
}

/** `rule` with a leading `~/` of each of its words as the home directory, as the shell reads a command. */
function atHome(rule: string): string {
  return rule.replace(/(^|\s)~\//g, `$1${homedir()}/`);
}

/** Where a command may send its output to: the temporary directories, and no `..` out of them. */
export const TEMP_ROOTS: readonly string[] = ['/tmp/', '/private/tmp/'];

/** Variables a command may not set in front of itself: they change what a rule's program is or does. */
const UNSAFE_VARIABLES = /^(?:PATH|HOME|SHELL|IFS|ENV|BASH_ENV|LD_\w*|DYLD_\w*|NODE_\w*|BUN_\w*|PYTHON\w*|GIT_\w*|OBEYA_\w*|SEISMIC_\w*|NPM_\w*)$/;

/**
 * The parts of a script that the shell runs one after the other (`&&`, `;`, a new line); null
 * where the script has any other syntax outside quotes: pipes, `||`, `&`, substitution,
 * expansion, globs, heredocs, input redirection, groups. Output redirection stays in its part.
 */
function parts(script: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!;
    if (c === "'" || c === '"') {
      const end = script.indexOf(c, i + 1);
      if (end < 0) return null;
      const quoted = script.slice(i, end + 1);
      // inside double quotes the shell still expands these
      if (c === '"' && /[\\$`]/.test(quoted)) return null;
      cur += quoted;
      i = end;
    } else if (c === '&') {
      if (script[i + 1] === '&') {
        out.push(cur);
        cur = '';
        i++;
      } else if (cur.endsWith('>') && /\d/.test(script[i + 1] ?? '')) cur += c;
      else return null;
    } else if (c === ';' || c === '\n' || c === '\r') {
      out.push(cur);
      cur = '';
    } else if (c === '~' && /(^|\s)$/.test(cur) && script[i + 1] === '/') cur += c;
    else if (/[|\\$`(){}!~#*?[\]<]/.test(c)) return null;
    else cur += c;
  }
  out.push(cur);
  const nonEmpty = out.map((p) => p.trim()).filter(Boolean);
  return nonEmpty.length ? nonEmpty : null;
}

/** `part` without its output redirections (to a file under a temporary directory, and `2>&1`); null for any other. */
function withoutRedirects(part: string, roots: readonly string[]): string | null {
  // what lies between quotes is no syntax: masked, it keeps its place and its length
  const mask = part.replace(/'[^']*'|"[^"]*"/g, (m) => 'x'.repeat(m.length));
  let rest = '';
  let at = 0;
  for (const m of mask.matchAll(/(?:^|\s)(\d*)(>>?)(?:&(\d))?\s*([^\s>]*)/g)) {
    const [whole, fd, , dup, target] = m;
    const from = m.index!;
    // `2>&1`
    if (dup !== undefined) {
      if (fd !== '2' || dup !== '1') return null;
    } else {
      const file = part.slice(from + whole!.length - target!.length, from + whole!.length);
      if ((fd !== '' && fd !== '1' && fd !== '2') || !/^[\w./-]+$/.test(file) || !roots.some((r) => file.startsWith(r)) || file.split('/').includes('..')) return null;
    }
    rest += part.slice(at, from);
    at = from + whole!.length;
  }
  rest += part.slice(at);
  return /[<>]/.test(rest.replace(/'[^']*'|"[^"]*"/g, '')) ? null : rest.trim();
}

/**
 * The plain commands a request stands for, in the order they run: `/bin/zsh -lc '<script>'` (the
 * shell Codex wraps a command in) as the script inside it, split at `&&`, `;` and new lines, each
 * without the variables set in front of it and without output redirected to a temporary
 * directory. Null for anything else.
 */
export function plainCommands(command: unknown, roots: readonly string[] = TEMP_ROOTS): string[] | null {
  return plainParts(command, roots)?.map((p) => p.command) ?? null;
}

/** `plainCommands`, each with whether variables were set in front of it. */
function plainParts(command: unknown, roots: readonly string[]): { command: string; set: boolean }[] | null {
  const argv = Array.isArray(command) ? command.map(String) : typeof command === 'string' ? words(command) : null;
  if (!argv?.length) return null;
  let script: string;
  if (/^(?:\/(?:usr\/)?bin\/)?(?:zsh|bash|sh)$/.test(argv[0]!)) {
    if (argv.length !== 3 || (argv[1] !== '-lc' && argv[1] !== '-c')) return null;
    script = argv[2]!;
  } else script = Array.isArray(command) ? argv.join(' ') : String(command);
  const split = parts(script);
  if (!split) return null;
  const commands: { command: string; set: boolean }[] = [];
  for (const part of split) {
    const bare = withoutRedirects(part, roots);
    const inner = bare === null ? null : words(bare);
    if (!inner?.length) return null;
    let set = false;
    while (inner.length && /^[A-Za-z_]\w*=/.test(inner[0]!)) {
      if (UNSAFE_VARIABLES.test(inner[0]!.split('=')[0]!)) return null;
      inner.shift();
      set = true;
    }
    // `..` in a path would take a text pattern out of the directory it names
    if (!inner.length || inner.some((w) => w.split('/').includes('..'))) return null;
    commands.push({ command: inner.join(' '), set });
  }
  return commands;
}

/** The one plain command a request stands for; null where it is none or several. */
export function plainCommand(command: unknown): string | null {
  const all = plainCommands(command);
  return all?.length === 1 ? all[0]! : null;
}

/**
 * Whether `rule` (a `Bash(...)` pattern, `*` for any text, a space before it making the word end
 * there; Claude Code's older `prefix:*`, the prefix alone or followed by more words) covers `command`.
 */
function covers(rule: string, command: string): boolean {
  const pattern = atHome(rule.trim());
  if (pattern.endsWith(':*') && !pattern.slice(0, -2).includes('*')) {
    const prefix = pattern.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  const parts = pattern.split('*');
  const star = parts.length > 1;
  if (!star) return pattern === command;
  const escaped = parts.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`, 's').test(command);
}

/** Whether `dir` is `root` or lies in it. */
const inside = (dir: string, root: string) => dir === root.replace(/\/$/, '') || dir.startsWith(root.endsWith('/') ? root : `${root}/`);

/** `path` as the file or directory it really is, symlinks resolved; null where it does not exist. */
function real(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

/**
 * Whether a plain command only prepares the shell for the commands after it: `source` (or `.`) of
 * an absolute file outside the places the agent can write (`writable`, the temporary directories),
 * since what it runs is then what the owner's machine holds, not what the agent wrote,
 * that exists, or `nvm use` with at most a version and `--silent`/`--lts`. Never with nothing writable named:
 * then it is unknown where the agent writes.
 */
function setup(plain: string, writable: readonly string[]): boolean {
  const w = plain.split(' ');
  if ((w[0] === 'source' || w[0] === '.') && w.length === 2) {
    const file = w[1]!;
    // a file that is not there yet, or a link to one, the agent could still make
    const resolved = file.startsWith('/') ? real(file) : null;
    if (!writable.length || !resolved) return false;
    const places = [...writable, ...TEMP_ROOTS, tmpdir()].flatMap((p) => [p, real(p) ?? p]);
    return ![file, resolved].some((f) => places.some((p) => inside(f, p)));
  }
  if (w[0] === 'nvm' && w[1] === 'use') {
    const rest = w.slice(2).filter((a) => a !== '--silent');
    return rest.length <= 1 && rest.every((a) => /^--lts(?:=[\w-]+)?$/.test(a) || /^[\w.][\w./-]*$/.test(a));
  }
  return false;
}

/**
 * Whether allow rules cover every command of an approval request: only then may it be granted
 * without asking. Leading commands that only prepare the shell (`setup`, given the places the agent
 * can write) need no rule, as long as a covered command follows them.
 */
export function allowed(rules: string[], command: unknown, roots?: readonly string[], writable: readonly string[] = []): boolean {
  const all = plainParts(command, roots ?? TEMP_ROOTS);
  if (all === null) return false;
  let first = 0;
  // a variable set in front of the setup (`NVM_DIR=…`) would let the agent choose what it loads
  while (first < all.length && !all[first]!.set && setup(all[first]!.command, writable)) first++;
  const rest = all.slice(first);
  return rest.length > 0 && rest.every((plain) => rules.some((r) => covers(r, plain.command)));
}
