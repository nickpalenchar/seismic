import { useEffect, useState } from 'react';
import { api } from './api';
import { phoneView } from './phone';
import { failText, t } from './strings';
import { Button } from './components/button';
import { Input } from './components/input';

/** Whether this browser runs on the machine Seismic runs on, asked once per page. */
let local: Promise<boolean> | undefined;
const onThisMachine = () => (local ??= api.access().then((v) => v.local, () => true));

/** Signing Claude in again, under the error that says it is signed out: hints on lines of their own, the buttons between. */
const reauthClass = 'reauthenticate flex items-center flex-wrap gap-x-3 gap-y-2 mt-2.5 [--button-bg:var(--card)] [&>div]:basis-full [&_code]:[overflow-wrap:anywhere] [&_code]:whitespace-normal';

/**
 * The same terminal login as Setup, offered where an agent's expired login interrupted a chat. A
 * session that signed in with a token (`token`: on another machine, or on CLAUDE_CODE_OAUTH_TOKEN)
 * gets a new one instead: `claude setup-token` in a terminal, its token pasted here for Seismic to keep.
 * The terminal opens on the machine Seismic runs on, so the phone view and another device get no
 * button, only where to go.
 */
export function Reauthenticate({ start = false, token = false }: { start?: boolean; token?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [command, setCommand] = useState('');
  const [pasted, setPasted] = useState('');
  const [saved, setSaved] = useState(false);
  const [here, setHere] = useState(() => !phoneView());
  useEffect(() => {
    let live = true;
    if (here) void onThisMachine().then((v) => live && setHere(v));
    return () => void (live = false);
  }, []);
  const login = async () => {
    setBusy(true);
    setStatus('');
    try {
      const { opened, command } = await api.setupLogin('needed', 'claudeLogin', token);
      setCommand(command);
      setStatus(opened ? t.setup.terminalOpen : t.setup.noTerminal);
    } catch (e) {
      setStatus(failText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.setupToken(pasted.trim());
      setPasted('');
      setSaved(true);
      setStatus('');
    } catch (e) {
      setStatus(failText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!here) return <div className={reauthClass}><div className="hint">{t.setup.atComputer(token)}</div></div>;
  if (saved) return <div className={reauthClass}><div className="hint" role="status">{t.setup.tokenSaved(start)}</div></div>;
  return (
    <div className={reauthClass}>
      {token && <div className="hint">{t.setup.tokenWhy}</div>}
      <Button size="small" disabled={busy} onClick={() => void login()}>{token ? t.setup.newToken : t.setup.reauthenticate}</Button>
      {status && <span className="hint" role="status">{status}</span>}
      {command && <div className="hint"><code>{command}</code></div>}
      {command && !token && <div className="hint">{start ? t.setup.startAfterReauthenticate : t.setup.afterReauthenticate}</div>}
      {command && token && (
        <form className="reauthenticate-token flex flex-col gap-1.5 basis-full not-italic [&_input]:flex-1 [&_input]:min-w-0" onSubmit={(e) => (e.preventDefault(), void save())}>
          <label className="hint" htmlFor="reauthenticate-token">{t.setup.pasteToken}</label>
          <div className="flex items-center gap-2 my-1">
            <Input id="reauthenticate-token" type="password" autoComplete="off" spellCheck={false} placeholder={t.setup.tokenPlaceholder} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <Button size="small" type="submit" disabled={busy || !pasted.trim()}>{t.setup.saveToken}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
