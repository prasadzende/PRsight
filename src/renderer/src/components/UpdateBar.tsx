// The update bar at the top of the window. It appears in place (no pop-ups) when an update is
// available, while it downloads, when it's ready to install, and after a check the person asked for.
import { useEffect, useState } from 'react';
import type { UpdateState } from '@shared/ipc';
import { api, call, errText, open } from '../api';
import { Spinner } from './ui';

const RELEASES = 'https://github.com/prasadzende/PRsight/releases/latest';

export function useUpdateState(): UpdateState | null {
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void call('update:get').then((s) => live && setSt(s));
    const off = api.on('update:state', (s) => setSt(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return st;
}

/** A key per thing worth showing, so "Later" hides that one and the next news still shows. */
const keyOf = (s: UpdateState): string => `${s.status}:${'version' in s ? s.version : ''}:${'checkedAt' in s ? s.checkedAt : ''}:${'message' in s ? s.message : ''}`;

export function UpdateBar() {
  const st = useUpdateState();
  const [hidden, setHidden] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const [err, setErr] = useState('');
  if (!st) return null;
  const show =
    st.status === 'available' || st.status === 'downloading' || st.status === 'ready' || (st.manual && (st.status === 'checking' || st.status === 'none' || st.status === 'error'));
  if (!show || hidden === keyOf(st)) return null;
  const later = () => setHidden(keyOf(st));
  const run = (p: Promise<unknown>) => p.catch((e) => setErr(errText(e)));

  let text: React.ReactNode = null;
  let actions: React.ReactNode = null;
  if (st.status === 'checking') {
    text = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Spinner /> Checking for updates…
      </span>
    );
  } else if (st.status === 'none') {
    text = `You’re up to date. PRsight ${st.current} is the latest version.`;
    actions = <button className="push" onClick={later}>OK</button>;
  } else if (st.status === 'available') {
    text = (
      <>
        <b>PRsight {st.version} is available.</b> <span className="t2">You have {st.current}.</span>
      </>
    );
    actions = (
      <>
        {st.notes && <button className="push" onClick={() => setNotes(!notes)} aria-expanded={notes}>{notes ? 'Hide Details' : 'What’s New'}</button>}
        <button className="push" onClick={later}>Later</button>
        <button className="prominent" onClick={() => void run(call('update:download'))} title={st.canInstall ? 'Download and install the update' : 'Opens the release on GitHub. This copy can’t install updates itself.'}>
          {st.canInstall ? 'Update Now' : 'Download'}
        </button>
      </>
    );
  } else if (st.status === 'downloading') {
    text = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        Downloading PRsight {st.version}… {st.percent}%
        <span className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={st.percent} aria-label="Download progress">
          <span style={{ width: `${st.percent}%` }} />
        </span>
      </span>
    );
  } else if (st.status === 'ready') {
    text = <b>PRsight {st.version} is ready. Restart to finish updating.</b>;
    actions = (
      <>
        <button className="push" onClick={later} title="It installs the next time you quit">Later</button>
        <button className="prominent" onClick={() => void run(call('update:install'))}>Restart Now</button>
      </>
    );
  } else if (st.status === 'error') {
    text = <>Couldn’t update: {st.message}</>;
    actions = (
      <>
        <button className="push" onClick={later}>Dismiss</button>
        <button className="push" onClick={() => open(RELEASES)}>Open Releases</button>
        <button className="prominent" onClick={() => void run(call('update:check'))}>Try Again</button>
      </>
    );
  }

  return (
    <div className="update-bar" role="status" aria-live="polite">
      <div className="update-row">
        <span className="update-text">{text}</span>
        {err && <span style={{ color: 'var(--gap)', fontSize: 12 }}>{err}</span>}
        <span style={{ flex: 1 }} />
        {actions}
      </div>
      {notes && st.status === 'available' && st.notes && <div className="update-notes">{st.notes}</div>}
    </div>
  );
}
