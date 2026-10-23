import { useState } from 'react';
import type { DeviceCode } from '@shared/ipc';
import { call, errText, open } from '../api';
import { useApp } from '../store';
import { Spinner } from './ui';

export function SignIn() {
  const set = useApp((s) => s.set);
  const auth = useApp((s) => s.auth);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const device = async () => {
    setErr(null);
    setBusy(true);
    try {
      const c = await call('auth:startDevice');
      setCode(c);
      open(c.verificationUri);
      let interval = c.interval * 1000;
      const deadline = Date.now() + c.expiresIn * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval));
        const r = await call('auth:pollDevice', { deviceCode: c.deviceCode, interval: c.interval });
        if (r.done) {
          if (r.error) throw new Error(r.error);
          if (r.status) set({ auth: r.status });
          return;
        }
        interval = Math.min(interval + 1000, 15_000);
      }
      throw new Error('The code expired. Try again.');
    } catch (e) {
      setErr(errText(e));
      setCode(null);
    } finally {
      setBusy(false);
    }
  };

  const ghCli = async () => {
    setErr(null);
    setBusy(true);
    try {
      set({ auth: await call('auth:useGhCli') });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const signInWithToken = async () => {
    setErr(null);
    setBusy(true);
    try {
      set({ auth: await call('auth:useToken', { token }) });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      setToken('');
    }
  };

  return (
    <div className="drag" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--win)' }}>
      <div className="card nodrag" style={{ width: 420, padding: '28px 30px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center' }}>
        <svg width="60" height="60" viewBox="100 100 824 824" aria-hidden="true">
          <defs>
            <linearGradient id="prsight-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6366F1" />
              <stop offset="1" stopColor="#3B1D9A" />
            </linearGradient>
          </defs>
          <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#prsight-bg)" />
          <path d="M212 512 C 318 300, 706 300, 812 512 C 706 724, 318 724, 212 512 Z" fill="#fff" />
          <circle cx="512" cy="512" r="142" fill="#2F1A8C" />
          <path d="M462 452 V572 M562 452 C 562 520, 462 512, 462 572" stroke="#fff" strokeWidth="20" strokeLinecap="round" fill="none" />
          <circle cx="462" cy="452" r="27" fill="#fff" />
          <circle cx="562" cy="452" r="27" fill="#fff" />
          <circle cx="462" cy="572" r="27" fill="#fff" />
        </svg>
        <span style={{ fontSize: 19, fontWeight: 600 }}>PRsight</span>
        <span className="t2" style={{ lineHeight: 1.5 }}>Review related pull requests together. Sign in to GitHub to see the pull requests you can review.</span>
        {code ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <span className="t2">Enter this code at {code.verificationUri.replace('https://', '')}</span>
            <span className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '.12em' }}>{code.userCode}</span>
            <span className="t3" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Waiting for you to approve in the browser…</span>
          </div>
        ) : (
          <>
            <button className="prominent" style={{ width: '100%', padding: '8px 12px', opacity: auth?.clientIdConfigured ? 1 : 0.5 }} disabled={busy || !auth?.clientIdConfigured} onClick={() => void device()}>
              Sign In with GitHub
            </button>
            {!auth?.clientIdConfigured && <span className="t3" style={{ fontSize: 12 }}>The GitHub App isn’t configured yet. Until your administrator sets it up, sign in with the GitHub CLI.</span>}
            <button className="push" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={() => void ghCli()}>
              Use My GitHub CLI Sign-In
            </button>
            <button style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }} onClick={() => setShowToken(!showToken)}>
              {showToken ? 'Hide' : 'Use a personal access token instead'}
            </button>
            {showToken && (
              <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                <label className="sr" htmlFor="pat">Personal access token</label>
                <input id="pat" type="password" className="field" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" style={{ flex: 1, padding: '6px 8px' }} />
                <button className="push" disabled={busy || token.length < 20} onClick={() => void signInWithToken()}>Sign In</button>
              </div>
            )}
          </>
        )}
        {err && <span style={{ color: 'var(--gap)', fontSize: 12.5 }}>{err}</span>}
        <span className="t3" style={{ fontSize: 11.5, lineHeight: 1.45 }}>Read access to code and PRs. The app writes only comments, replies and reviews, and only when you click to post them. Your token is kept in the system keychain.</span>
      </div>
    </div>
  );
}
