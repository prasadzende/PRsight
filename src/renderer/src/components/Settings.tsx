import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import type { ProviderId, SecretName, Settings as S } from '@shared/ipc';
import { call, errText } from '../api';
import { useApp } from '../store';
import { explainReport } from '../actions';
import { Icon, Seg, Spinner, Switch } from './ui';
import { useUpdateState } from './UpdateBar';

type Tab = 'general' | 'accounts' | 'boards' | 'ai' | 'privacy';
const TABS: Array<[Tab, string, string, string]> = [
  ['general', 'General', '#8e8e93', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'],
  ['accounts', 'Accounts', '#0a6fe0', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0'],
  ['boards', 'Boards', '#1f8a4c', 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z'],
  ['ai', 'AI', '#8a4fd8', 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
  ['privacy', 'Privacy & Data', '#3478f6', 'M12 3l7 3v5c0 4.5-3 8.3-7 9.5-4-1.2-7-5-7-9.5V6zM9.5 12l2 2 3.5-4'],
];

export function Settings({ dark }: { dark: boolean }) {
  const s = useApp();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => call('settings:get') });
  const save = async (patch: Partial<S>) => {
    const next = await call('settings:set', patch);
    qc.setQueryData(['settings'], next);
  };
  const tab = s.setTab;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && s.set({ settingsOpen: false })}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.15)' }} />
        <Dialog.Content className={`app ${dark ? 'dark' : ''}`} style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 760, height: 580, borderRadius: 12, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'row', overflow: 'hidden', background: 'var(--win)' }}>
          <nav style={{ width: 210, background: 'var(--side)', padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2, borderRight: '.5px solid var(--sep)' }}>
            <Dialog.Title style={{ fontSize: 13, fontWeight: 600, padding: '4px 8px 10px', margin: 0 }}>Settings</Dialog.Title>
            {TABS.map(([id, label, bg, icon]) => (
              <button key={id} className={tab === id ? 'side-on' : 'side-row'} onClick={() => s.set({ setTab: id })} style={{ padding: '5px 8px' }}>
                <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 5, background: bg, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon d={icon} size={13} stroke={1.8} /></span>
                {label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <Dialog.Close className="push" style={{ justifyContent: 'center' }}>Done</Dialog.Close>
          </nav>
          <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ margin: '0 0 14px', fontSize: 17 }}>{TABS.find((t) => t[0] === tab)?.[1]}</h2>
            {settings.data && (
              <>
                {tab === 'general' && <General st={settings.data} save={save} />}
                {tab === 'accounts' && <Accounts st={settings.data} save={save} />}
                {tab === 'boards' && <Boards st={settings.data} save={save} />}
                {tab === 'ai' && <Ai st={settings.data} save={save} />}
                {tab === 'privacy' && <Privacy st={settings.data} save={save} />}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type P = { st: S; save: (p: Partial<S>) => Promise<void> };
export type SettingsProps = P;
const ADO_AUTH_HELP = {
  azcli: 'Reuses your “az login” in Terminal. Nothing to paste here.',
  pat: 'A token you create in Azure DevOps › User settings › Personal access tokens.',
  entra: 'Your Microsoft account through an Entra app registration (needs tenant and app ID).',
} as const;
export const Grp = ({ children, ...rest }: { children: ReactNode; role?: string; 'aria-label'?: string }) => <div className="grp" {...rest}>{children}</div>;
export const Row = ({ label, sub, children }: { label: string; sub?: string; children?: ReactNode }) => (
  <div className="grow">
    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, minWidth: 0 }}><span>{label}</span>{sub && <span className="t3" style={{ fontSize: 11.5 }}>{sub}</span>}</span>
    <span style={{ flex: '0 0 auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>{children}</span>
  </div>
);
export const Cap = ({ children }: { children?: ReactNode }) => <div className="gcap">{children ?? ' '}</div>;

export function Text({ value, onSave, placeholder, width = 240, secret }: { value: string; onSave: (v: string) => void; placeholder?: string; width?: number; secret?: boolean }) {
  const [v, setV] = useState(value);
  return <input className="field" type={secret ? 'password' : 'text'} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} style={{ padding: '4px 8px', width }} aria-label={placeholder} />;
}

export function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <select className="popup" aria-label={label} value={String(value)} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)} style={{ color: 'var(--text)' }}>
      {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
    </select>
  );
}

function General({ st, save }: P) {
  const s = useApp();
  return (
    <>
      <Grp>
        <Row label="Appearance"><Seg value={st.appearance} label="Appearance" onChange={(v) => void save({ appearance: v })} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']]} /></Row>
        <Row label="Accent colour"><span className="t2" style={{ fontSize: 12.5 }}>Follows system</span></Row>
      </Grp>
      <Cap />
      <Grp>
        <Row label="Refresh pull requests"><Select value={st.refreshMinutes} label="Refresh" onChange={(v) => void save({ refreshMinutes: v })} options={[[0, 'Manually'], [2, 'Every 2 minutes'], [5, 'Every 5 minutes'], [15, 'Every 15 minutes']]} /></Row>
        <Row label="Only while the window is active"><Switch label="Only refresh while the window is active" checked={st.refreshOnlyActive} onChange={(v) => void save({ refreshOnlyActive: v })} /></Row>
      </Grp>
      <Cap />
      <Grp>
        <Row label="Stored data and connections"><button className="push" onClick={() => s.set({ setTab: 'privacy' })}>Privacy &amp; Data…</button></Row>
        <Row label="Setup" sub="Walks you through AI and a ticket board again"><button className="push" onClick={() => s.set({ settingsOpen: false, setupOpen: true, setupStep: 'ai' })}>Run Setup Again…</button></Row>
      </Grp>
      <Cap>Reports and file snapshots are stored on this computer only.</Cap>
    </>
  );
}

function Accounts({ st, save }: P) {
  const s = useApp();
  const info = useQuery({ queryKey: ['info'], queryFn: () => call('app:info') });
  return (
    <>
      <Grp>
        <Row label="GitHub" sub={s.auth?.login ? `Signed in as ${s.auth.login}` : 'Not signed in'}>
          <button className="push" onClick={async () => { s.set({ auth: await call('auth:signOut'), settingsOpen: false }); }}>Sign Out…</button>
        </Row>
        <Row label="Access"><span className="t2" style={{ fontSize: 12.5 }}>Read code and PRs · write PR comments and reviews</span></Row>
        <Row label="Token stored in"><span className="t2" style={{ fontSize: 12.5 }}>{info.data?.keychain}</span></Row>
      </Grp>
      <Cap>Replies, comments and reviews are only posted when you click Reply, Comment or Submit Review.</Cap>
      <Grp>
        <Row label="Organisation"><Text value={st.org} onSave={(v) => void save({ org: v })} placeholder="Blank: your account" width={180} /></Row>
        <Row label="Repositories" sub="Leave empty to list PRs from the whole organisation"><Text value={st.repos.join(', ')} onSave={(v) => void save({ repos: v.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="repo-a, repo-b" width={240} /></Row>
        <Row label="GitHub App client ID" sub="Set by your administrator for Sign In with GitHub"><Text value={st.github.clientId} onSave={(v) => void save({ github: { ...st.github, clientId: v.trim() } })} placeholder="Iv1.…" width={180} /></Row>
        <Row label="GitHub host"><Text value={st.github.host} onSave={(v) => void save({ github: { ...st.github, host: v.trim() || 'github.com' } })} placeholder="github.com" width={180} /></Row>
      </Grp>
    </>
  );
}

function Boards({ st, save }: P) {
  const [msg, setMsg] = useState<Record<string, string>>({});
  const b = st.boards;
  const test = async (system: 'ado' | 'jira') => {
    const r = await call('boards:test', { system });
    setMsg({ ...msg, [system]: r.message });
  };
  return (
    <>
      <Grp>
        <Row label="Azure DevOps" sub="Read-only. Looks up ticket titles and acceptance criteria."><Switch label="Azure DevOps" checked={b.ado.enabled} onChange={(v) => void save({ boards: { ...b, ado: { ...b.ado, enabled: v } } })} /></Row>
        {b.ado.enabled && (
          <>
            <AdoFields st={st} save={save} />
            <Row label="Connection" sub={msg.ado}><button className="push" onClick={() => void test('ado')}>Test</button></Row>
          </>
        )}
      </Grp>
      <Cap>Work item IDs are unique across an Azure DevOps organisation, so looking up a ticket only needs the organisation.</Cap>
      <Grp>
        <Row label="Jira" sub="Read-only. Uses an Atlassian API token."><Switch label="Jira" checked={b.jira.enabled} onChange={(v) => void save({ boards: { ...b, jira: { ...b.jira, enabled: v } } })} /></Row>
        {b.jira.enabled && (
          <>
            <JiraFields st={st} save={save} />
            <Row label="Connection" sub={msg.jira}><button className="push" onClick={() => void test('jira')}>Test</button></Row>
          </>
        )}
      </Grp>
      <Cap />
      <Grp>
        {(['title', 'branch', 'description', 'commits'] as const).map((k) => (
          <Row key={k} label={`Find ticket numbers in the ${k === 'commits' ? 'commit messages' : k}`}><Switch label={k} checked={b.detect[k]} onChange={(v) => void save({ boards: { ...b, detect: { ...b.detect, [k]: v } } })} /></Row>
        ))}
      </Grp>
      <Cap>You can also add ticket numbers by hand in a report’s Tickets view.</Cap>
    </>
  );
}

/** Azure DevOps connection fields (shared by Settings › Boards and the setup wizard). */
export function AdoFields({ st, save }: P) {
  const b = st.boards;
  return (
    <>
      <Row label="Organisation"><Text value={b.ado.org} onSave={(v) => void save({ boards: { ...b, ado: { ...b.ado, org: v } } })} placeholder="your-org" width={180} /></Row>
      <Row label="Default project" sub="Optional"><Text value={b.ado.project} onSave={(v) => void save({ boards: { ...b, ado: { ...b.ado, project: v } } })} placeholder="Project" width={180} /></Row>
      <Row label="Default team board" sub="Optional: scopes suggestions for your team"><Text value={b.ado.team} onSave={(v) => void save({ boards: { ...b, ado: { ...b.ado, team: v } } })} placeholder="Team" width={180} /></Row>
      <Row label="Sign in with" sub={ADO_AUTH_HELP[b.ado.auth]}>
        <Select value={b.ado.auth} label="Azure DevOps sign-in" onChange={(v) => void save({ boards: { ...b, ado: { ...b.ado, auth: v } } })} options={[['azcli', 'Azure CLI (az login)'], ['pat', 'Personal access token'], ['entra', 'Entra ID app']]} />
      </Row>
      {b.ado.auth === 'pat' && <Row label="Personal access token" sub="Scope: Work Items (Read) only, short expiry. Stored in the system keychain."><SecretInput name="ado" /></Row>}
      {b.ado.auth === 'entra' && (
        <>
          <Row label="Entra tenant ID"><Text value={b.ado.tenantId} onSave={(v) => void save({ boards: { ...b, ado: { ...b.ado, tenantId: v.trim() } } })} placeholder="Tenant ID" width={240} /></Row>
          <Row label="Entra app (client) ID"><Text value={b.ado.clientId} onSave={(v) => void save({ boards: { ...b, ado: { ...b.ado, clientId: v.trim() } } })} placeholder="App ID" width={240} /></Row>
        </>
      )}
    </>
  );
}

/** Jira connection fields (shared by Settings › Boards and the setup wizard). */
export function JiraFields({ st, save }: P) {
  const b = st.boards;
  return (
    <>
      <Row label="Site"><Text value={b.jira.site} onSave={(v) => void save({ boards: { ...b, jira: { ...b.jira, site: v.trim() } } })} placeholder="yourcompany.atlassian.net" width={240} /></Row>
      <Row label="Email"><Text value={b.jira.email} onSave={(v) => void save({ boards: { ...b, jira: { ...b.jira, email: v.trim() } } })} placeholder="you@company.com" width={240} /></Row>
      <Row label="API token" sub="Stored in the system keychain"><SecretInput name="jira" /></Row>
      <Row label="Project keys" sub="Optional, e.g. PLAT, OPS"><Text value={b.jira.projectKeys.join(', ')} onSave={(v) => void save({ boards: { ...b, jira: { ...b.jira, projectKeys: v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) } } })} placeholder="PLAT" width={180} /></Row>
    </>
  );
}

export function SecretInput({ name }: { name: SecretName }) {
  const qc = useQueryClient();
  const has = useQuery({ queryKey: ['secrets'], queryFn: () => call('secrets:has') });
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (has.data?.[name])
    return (
      <>
        <span className="t2" style={{ fontSize: 12.5 }}>Saved</span>
        <button className="push" onClick={async () => { await call('secrets:delete', { name }); void qc.invalidateQueries({ queryKey: ['secrets'] }); void qc.invalidateQueries({ queryKey: ['providers'] }); }}>Remove</button>
      </>
    );
  return (
    <>
      <input className="field" type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="Paste key" aria-label={`${name} key`} style={{ padding: '4px 8px', width: 180 }} />
      <button className="push" disabled={!v} onClick={async () => {
        try { await call('secrets:set', { name, value: v }); setV(''); setErr(null); void qc.invalidateQueries({ queryKey: ['secrets'] }); void qc.invalidateQueries({ queryKey: ['providers'] }); } catch (e) { setErr(errText(e)); }
      }}>Save</button>
      {err && <span style={{ color: 'var(--gap)', fontSize: 11.5 }}>{err}</span>}
    </>
  );
}

function Ai({ st, save }: P) {
  const providers = useQuery({ queryKey: ['providers', st.ai.provider], queryFn: () => call('ai:providers') });
  const [test, setTest] = useState<string | null>(null);
  const a = st.ai;
  const groups: Array<['subscription' | 'company' | 'key', string]> = [['subscription', 'Your Claude subscription'], ['company', 'Company cloud (no personal key)'], ['key', 'Your own API key']];
  const pick = (id: ProviderId) => void save({ ai: { ...a, provider: id } });
  return (
    <>
      <Grp>
        <Row label="AI explanations" sub="Summaries and link notes written by an AI model. Saved on this computer and remembered next time."><Switch label="AI explanations" checked={a.enabled} onChange={(v) => void save({ ai: { ...a, enabled: v } })} /></Row>
      </Grp>
      <ExplainOpenReport enabled={a.enabled} />
      <Cap />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: a.enabled ? 1 : 0.45 }}>
        {groups.map(([g, label]) => {
          const items = (providers.data ?? []).filter((p) => p.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div style={{ fontSize: 13, fontWeight: 600, margin: '10px 2px 6px' }}>{label}</div>
              <Grp role="radiogroup" aria-label="AI provider">
                {items.map((p) => {
                  const on = a.provider === p.id;
                  return (
                    <div key={p.id}>
                      <button className="grow prow" role="radio" aria-checked={on} onClick={() => !on && pick(p.id)} style={{ justifyContent: 'flex-start', opacity: on ? 1 : 0.7 }}>
                        <span aria-hidden="true" className={on ? 'radio radio-on' : 'radio'} />
                        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, textAlign: 'left', flex: 1 }}><span style={{ fontWeight: on ? 600 : 400 }}>{p.name}</span><span className="t3" style={{ fontSize: 11.5 }}>{p.sub}</span></span>
                        {on && <span style={{ fontSize: 11.5, color: p.ready ? 'var(--al)' : 'var(--warn)' }}>{p.status}</span>}
                      </button>
                      {on && <ProviderFields id={p.id} st={st} save={save} />}
                    </div>
                  );
                })}
              </Grp>
            </div>
          );
        })}
      </div>
      <Cap>Secrets are removed from diffs before anything is sent, and AI text is always marked with the AI badge. Your administrator controls which providers appear.</Cap>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="push" disabled={!a.enabled} onClick={async () => { setTest('Testing…'); const r = await call('ai:test', { provider: a.provider }); setTest(r.message); }}>Test Connection</button>
        {test && <span className="t2" style={{ fontSize: 12.5 }}>{test}</span>}
      </div>
    </>
  );
}

export function ProviderFields({ id, st, save }: { id: ProviderId } & P) {
  const a = st.ai;
  const model = () => <ModelPicker id={id} st={st} save={save} />;
  switch (id) {
    case 'claudecode':
      return <><Row label="How it works" sub="Runs the official claude CLI with your own sign-in. The app never sees your Claude password or tokens." /><ClaudePathRow provider={a.provider} />{model()}</>;
    case 'foundry':
      return (
        <>
          <Row label="Endpoint"><Text value={a.foundry.endpoint} onSave={(v) => void save({ ai: { ...a, foundry: { ...a.foundry, endpoint: v.trim() } } })} placeholder="https://<resource>.services.ai.azure.com" width={260} /></Row>
          <Row label="API key" sub="Stored in the system keychain"><SecretInput name="foundry" /></Row>
          {model()}
        </>
      );
    case 'azureopenai':
      return (
        <>
          <Row label="Endpoint"><Text value={a.azureOpenAI.endpoint} onSave={(v) => void save({ ai: { ...a, azureOpenAI: { ...a.azureOpenAI, endpoint: v.trim() } } })} placeholder="https://<name>.openai.azure.com" width={260} /></Row>
          <Row label="Deployment"><Text value={a.azureOpenAI.deployment} onSave={(v) => void save({ ai: { ...a, azureOpenAI: { ...a.azureOpenAI, deployment: v.trim() } } })} placeholder="Deployment name" width={200} /></Row>
          <Row label="API key" sub="Stored in the system keychain"><SecretInput name="azureopenai" /></Row>
        </>
      );
    case 'bedrock':
      return <><Row label="Region"><Text value={a.bedrock.region} onSave={(v) => void save({ ai: { ...a, bedrock: { region: v.trim() } } })} placeholder="eu-west-1" width={160} /></Row>{model()}</>;
    case 'vertex':
      return (
        <>
          <Row label="Project ID"><Text value={a.vertex.projectId} onSave={(v) => void save({ ai: { ...a, vertex: { ...a.vertex, projectId: v.trim() } } })} placeholder="my-project" width={200} /></Row>
          <Row label="Region"><Text value={a.vertex.region} onSave={(v) => void save({ ai: { ...a, vertex: { ...a.vertex, region: v.trim() } } })} placeholder="europe-west1" width={160} /></Row>
          {model()}
        </>
      );
    default:
      return <><Row label="API key" sub="Stored in the system keychain"><SecretInput name={id as SecretName} /></Row>{model()}</>;
  }
}

/**
 * Where the claude CLI is. It is found automatically (PATH, then the usual install folders);
 * only when that fails are you asked to choose it. The choice is checked in main before it is saved.
 */
function ClaudePathRow({ provider }: { provider: ProviderId }) {
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['providers', provider], queryFn: () => call('ai:providers') });
  const p = providers.data?.find((x) => x.id === 'claudecode');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['providers'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };
  const choose = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call('ai:pickClaude');
      if (r.message) setMsg({ ok: r.ok, text: r.message });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    await call('ai:clearClaude');
    setMsg(null);
    refresh();
  };
  const note = msg && <span role="status" style={{ fontSize: 12, color: msg.ok ? 'var(--al)' : 'var(--warn)' }}>{msg.text}</span>;
  if (!p || p.claudeSource === 'auto') return note ? <Row label="Claude Code">{note}</Row> : null;
  if (p.claudeSource === 'chosen') {
    return (
      <Row label="Claude Code location" sub="Chosen by you, because it wasn't found automatically.">
        {note}
        <button className="push" disabled={busy} onClick={() => void choose()}>Change…</button>
        <button className="push" disabled={busy} onClick={() => void forget()}>Forget</button>
      </Row>
    );
  }
  return (
    <Row label="Claude Code not found" sub={'Install Claude Code, or show the app where it is: usually ~/.local/bin/claude on macOS, or %USERPROFILE%\\.local\\bin\\claude.exe on Windows.'}>
      {note}
      <button className="push" disabled={busy} onClick={() => void choose()}>{busy ? 'Checking…' : 'Choose…'}</button>
    </Row>
  );
}

export const CLI_LABELS: Record<string, string> = { opus: 'Opus (most capable)', sonnet: 'Sonnet (balanced)', haiku: 'Haiku (fastest)' };

const KEY_OF: Partial<Record<ProviderId, SecretName>> = { anthropic: 'anthropic', openai: 'openai', gemini: 'gemini', foundry: 'foundry', azureopenai: 'azureopenai' };

/**
 * Model choice for one provider: a list (live from the provider when it can list them), a default, or a custom ID.
 * The list updates by itself: when a key is saved or removed, when the endpoint, region or project changes,
 * each time this opens, and every 30 minutes while it is on screen.
 */
function ModelPicker({ id, st, save }: { id: ProviderId } & P) {
  const a = st.ai;
  const has = useQuery({ queryKey: ['secrets'], queryFn: () => call('secrets:has') });
  const key = KEY_OF[id];
  const deps = [key ? !!has.data?.[key] : null, id === 'foundry' ? a.foundry.endpoint : id === 'bedrock' ? a.bedrock.region : id === 'vertex' ? `${a.vertex.projectId}@${a.vertex.region}` : null];
  const q = useQuery({
    queryKey: ['models', id, ...deps],
    queryFn: () => call('ai:models', { provider: id }),
    enabled: !key || has.isSuccess,
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchInterval: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
  const [custom, setCustom] = useState(false);
  const cur = a.models[id] ?? '';
  const list = q.data?.models ?? [];
  const loading = !q.data;
  const gone = !!cur && q.data?.source === 'live' && !q.isPlaceholderData && !list.includes(cur);
  const isCustom = custom || (!!cur && !loading && !q.isPlaceholderData && !list.includes(cur));
  const set = (v: string) => void save({ ai: { ...a, models: { ...a.models, [id]: v } } });
  const base = q.data?.note ?? (q.data?.source === 'live' ? `${list.length} models from the provider · updates by itself` : q.data?.source === 'known' ? 'Common models. Choose Custom… for any other model ID.' : undefined);
  const sub = gone ? `${cur} is no longer offered by the provider. Pick another model.` : q.isFetching && !loading ? 'Updating the list…' : base;
  const defLabel = id === 'claudecode' ? 'Default (your Claude Code setting)' : q.data?.default ? `Default (${q.data.default})` : 'Default';
  return (
    <>
      <Row label="Model" sub={sub}>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <select className="popup" aria-label={`Model for ${id}`} value={isCustom ? '__custom' : cur} disabled={loading}
            onChange={(e) => { const v = e.target.value; if (v === '__custom') setCustom(true); else { setCustom(false); set(v); } }}
            style={{ color: 'var(--text)', maxWidth: 240 }}>
            <option value="">{loading ? 'Loading models…' : defLabel}</option>
            {list.map((m) => <option key={m} value={m}>{id === 'claudecode' ? CLI_LABELS[m] ?? m : m}</option>)}
            <option value="__custom">Custom…</option>
          </select>
          {q.isFetching && !loading && <Spinner />}
        </span>
      </Row>
      {isCustom && <Row label="Model ID" sub="Exactly as the provider names it"><Text key={cur} value={cur} onSave={(v) => set(v.trim())} placeholder="Model ID" width={220} /></Row>}
    </>
  );
}

function Privacy({ st, save }: P) {
  const qc = useQueryClient();
  const s = useApp();
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => call('data:usage') });
  const [ask, setAsk] = useState(false);
  const p = st.privacy;
  const mb = (b: number) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : `${(b / 1e6).toFixed(1)} MB`);
  const clear = async (what: 'cache' | 'reports' | 'memory') => {
    await call('data:clear', { what });
    void qc.invalidateQueries({ queryKey: ['usage'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
  };
  return (
    <>
      <Grp>
        <Row label="Check for updates"><Select value={p.updateCheck} label="Check for updates" onChange={(v) => void save({ privacy: { ...p, updateCheck: v } })} options={[['daily', 'Once a day'], ['weekly', 'Once a week'], ['off', 'Never']]} /></Row>
        <Row label="Update source"><span className="t2" style={{ fontSize: 12.5 }}>{p.updateFeed ? new URL(p.updateFeed).hostname : 'GitHub Releases (prasadzende/PRsight)'}</span></Row>
        <UpdateRow />
      </Grp>
      <Cap />
      <Grp>
        <Row label="Keep copies of changed files" sub="Speeds up reopening reports. Off keeps only diffs."><Switch label="Keep copies of changed files" checked={p.keepFileCopies} onChange={(v) => void save({ privacy: { ...p, keepFileCopies: v } })} /></Row>
        <Row label="Delete data older than"><Select value={p.keepDays} label="Delete data older than" onChange={(v) => void save({ privacy: { ...p, keepDays: v } })} options={[[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']]} /></Row>
        <Row label="Stored in"><span className="mono t2" style={{ fontSize: 11 }}>{usage.data?.path}</span></Row>
      </Grp>
      <Cap />
      <Grp>
        <Row label="Cache" sub={usage.data ? `${mb(usage.data.cacheBytes)} · PRs, diffs and file copies` : ''}><button className="push" onClick={() => void clear('cache')}>Clear…</button></Row>
        <Row label="Reports" sub={usage.data ? `${usage.data.reports} reports · checklists and notes` : ''}><button className="push" onClick={() => void clear('reports')}>Clear…</button></Row>
        <Row label="Review memory" sub={usage.data ? `${usage.data.memoryNotes} notes from past reviews` : ''}><button className="push" onClick={() => void clear('memory')}>Clear…</button></Row>
      </Grp>
      <Cap />
      <Grp>
        {ask ? (
          <div className="grow" style={{ alignItems: 'flex-start' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.4 }}><b>Delete everything on this computer?</b><span className="t2" style={{ fontSize: 12 }}>Removes the cache, reports, review memory, settings and saved keys, and signs you out. Nothing on GitHub changes.</span></span>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button className="push" onClick={() => setAsk(false)}>Cancel</button>
              <button className="push" style={{ color: '#fff', background: 'var(--gap)', borderColor: 'var(--gap)' }} onClick={async () => { await call('data:deleteAll'); s.set({ auth: { signedIn: false, clientIdConfigured: false }, settingsOpen: false, report: null, selected: [], current: null }); }}>Delete</button>
            </span>
          </div>
        ) : (
          <Row label="Delete all local data"><button className="push" style={{ color: 'var(--gap)' }} onClick={() => setAsk(true)}>Delete All Local Data…</button></Row>
        )}
      </Grp>
      <Cap>Your laptop’s disk encryption (FileVault or BitLocker) protects this data. The cache holds copies of code: secrets are removed before any AI call, but the cache itself is not scanned.</Cap>
    </>
  );
}

function ExplainOpenReport({ enabled }: { enabled: boolean }) {
  const s = useApp();
  if (!enabled || !s.report || s.report.ai) return null;
  return (
    <div className="card" style={{ marginTop: 10, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ flex: 1, fontSize: 12.5 }}>AI is on. Add AI explanations to the report you have open?</span>
      <button className="prominent" disabled={s.explaining} onClick={() => { s.set({ settingsOpen: false }); void explainReport(); }}>{s.explaining ? 'Explaining…' : 'Explain Report'}</button>
    </div>
  );
}

/** Version, the last update result, and Check Now. Results also show in the update bar. */
function UpdateRow() {
  const u = useUpdateState();
  const [busy, setBusy] = useState(false);
  const status = !u
    ? ''
    : u.status === 'checking'
      ? 'Checking…'
      : u.status === 'none'
        ? `Up to date · checked ${new Date(u.checkedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
        : u.status === 'available'
          ? `Version ${u.version} is available`
          : u.status === 'downloading'
            ? `Downloading ${u.version}… ${u.percent}%`
            : u.status === 'ready'
              ? `Version ${u.version} is ready: restart to install`
              : u.status === 'error'
                ? u.message
                : 'Not checked yet';
  const check = async () => {
    setBusy(true);
    try {
      await call('update:check');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row label={`Version ${u?.current ?? ''}`} sub={status}>
      <button className="push" onClick={() => void check()} disabled={busy || u?.status === 'checking' || u?.status === 'downloading'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {busy && <Spinner />}
        Check Now
      </button>
    </Row>
  );
}
