// The setup wizard: AI (provider and model), then a ticket board, then a summary.
// It opens after sign-in while setup isn't done and AI or a board is still unset. Every step can be skipped.
// Skip Setup and Start Reviewing both mark setup done; Settings › General › Run Setup Again… and the
// "Set Up PRsight…" menu item bring it back. Fields are the same ones Settings uses, so keys go to the keychain.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import type { ProviderId, ProviderInfo, Settings as S } from '@shared/ipc';
import { ticketKeysOf } from '@analysis/tickets';
import { call, errText } from '../api';
import { useApp } from '../store';
import { AdoFields, CLI_LABELS, Grp, JiraFields, ProviderFields, type SettingsProps } from './Settings';
import { Spinner } from './ui';

type Step = 'ai' | 'boards' | 'done';
type Board = 'ado' | 'jira' | 'none';
const STEPS: Array<[Step, string]> = [['ai', 'AI'], ['boards', 'Ticket board'], ['done', 'Done']];
const GROUPS: Array<[ProviderInfo['group'], string]> = [['subscription', 'Your Claude subscription'], ['company', 'Company cloud (no personal key)'], ['key', 'Your own API key']];
const BOARD_NAMES: Record<Exclude<Board, 'none'>, string> = { ado: 'Azure DevOps', jira: 'Jira' };

export function SetupWizard({ dark }: { dark: boolean }) {
  const s = useApp();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => call('settings:get') });
  const save = async (patch: Partial<S>) => {
    const next = await call('settings:set', patch);
    qc.setQueryData(['settings'], next);
  };
  // What the boards were before the wizard, so changing your pick doesn't switch off a board you already had.
  const [before] = useState(() => (settings.data ? { ado: settings.data.boards.ado.enabled, jira: settings.data.boards.jira.enabled } : null));
  const [aiTest, setAiTest] = useState<{ busy: boolean; ok?: boolean; msg?: string }>({ busy: false });
  const [boardTest, setBoardTest] = useState<{ busy: boolean; ok?: boolean; msg?: string }>({ busy: false });
  const step = s.setupStep;
  const go = (to: Step) => s.set({ setupStep: to });
  const finish = async () => {
    await save({ setupDone: true }).catch(() => undefined);
    s.set({ setupOpen: false });
  };
  const st = settings.data;
  const idx = STEPS.findIndex(([k]) => k === step);

  const board: Board = st ? (st.boards.ado.enabled && !before?.ado ? 'ado' : st.boards.jira.enabled && !before?.jira ? 'jira' : st.boards.ado.enabled ? 'ado' : st.boards.jira.enabled ? 'jira' : 'none') : 'none';
  const pickBoard = (b: Board) => {
    if (!st) return;
    setBoardTest({ busy: false });
    const was = before ?? { ado: false, jira: false };
    void save({ boards: { ...st.boards, ado: { ...st.boards.ado, enabled: b === 'ado' || (b !== 'jira' && was.ado) }, jira: { ...st.boards.jira, enabled: b === 'jira' || (b !== 'ado' && was.jira) } } });
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && void finish()}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.2)' }} />
        <Dialog.Content
          className={`app ${dark ? 'dark' : ''}`}
          aria-describedby="wz-desc"
          style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 640, maxWidth: 'calc(100vw - 32px)', height: 620, maxHeight: 'calc(100vh - 32px)', borderRadius: 12, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--win)' }}
        >
          <div style={{ padding: '18px 22px 12px', borderBottom: '.5px solid var(--sep)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <Dialog.Title style={{ margin: 0, fontSize: 17 }}>Set up PRsight</Dialog.Title>
              <span className="t3" style={{ fontSize: 12 }}>Step {idx + 1} of {STEPS.length}</span>
            </div>
            <ol aria-label="Setup steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6 }}>
              {STEPS.map(([k, label], i) => (
                <li key={k} aria-current={k === step ? 'step' : undefined} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ height: 4, borderRadius: 2, background: i <= idx ? 'var(--accent)' : 'var(--field)' }} />
                  <span style={{ fontSize: 12, fontWeight: k === step ? 600 : 400, color: k === step ? 'var(--text)' : 'var(--text3)' }}>{i < idx ? '✓ ' : ''}{label}</span>
                </li>
              ))}
            </ol>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!st && <span className="t3" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading settings…</span>}
            {st && step === 'ai' && <AiStep st={st} save={save} test={aiTest} setTest={setAiTest} />}
            {st && step === 'boards' && <BoardStep st={st} save={save} board={board} pick={pickBoard} test={boardTest} setTest={setBoardTest} />}
            {st && step === 'done' && <DoneStep st={st} save={save} go={go} />}
          </div>

          <div style={{ padding: '12px 22px', borderTop: '.5px solid var(--sep)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bar)' }}>
            {step !== 'done' && <button className="brief-link" onClick={() => void finish()} title="Close setup. Run it again any time from Settings › General.">Skip Setup</button>}
            <span style={{ flex: 1 }} />
            {idx > 0 && <button className="push" onClick={() => go(STEPS[idx - 1][0])}>Back</button>}
            {step === 'ai' && st && (
              <>
                <button className="push" onClick={() => go('boards')}>Skip This Step</button>
                <button className="prominent" onClick={async () => { if (!st.ai.enabled) await save({ ai: { ...st.ai, enabled: true } }); go('boards'); }}>
                  {st.ai.enabled ? 'Continue' : 'Turn On AI and Continue'}
                </button>
              </>
            )}
            {step === 'boards' && (
              <>
                <button className="push" onClick={() => { pickBoard('none'); go('done'); }}>Skip This Step</button>
                <button className="prominent" onClick={() => go('done')}>Continue</button>
              </>
            )}
            {step === 'done' && <button className="prominent" onClick={() => void finish()}>Start Reviewing</button>}
          </div>
          <span id="wz-desc" className="sr">Choose an AI provider and model, then a ticket board. You can skip any step and change it later in Settings.</span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type TestState = { busy: boolean; ok?: boolean; msg?: string };
type TestProps = { test: TestState; setTest: (t: TestState) => void };

function TestResult({ test }: { test: TestState }) {
  if (test.busy) return <span className="t3" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Spinner /> Testing…</span>;
  if (!test.msg) return null;
  return <span role="status" style={{ fontSize: 12.5, color: test.ok ? 'var(--al)' : 'var(--gap)' }}>{test.ok ? '✓ ' : ''}{test.msg}</span>;
}

function AiStep({ st, save, test, setTest }: SettingsProps & TestProps) {
  const providers = useQuery({ queryKey: ['providers', st.ai.provider], queryFn: () => call('ai:providers') });
  const a = st.ai;
  const pick = (id: ProviderId) => {
    setTest({ busy: false });
    void save({ ai: { ...a, provider: id } });
  };
  const run = async () => {
    setTest({ busy: true });
    try {
      const r = await call('ai:test', { provider: a.provider });
      setTest({ busy: false, ok: r.ok, msg: r.message });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: errText(e) });
    }
  };
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ fontSize: 15 }}>Explain reports with AI</b>
        <span className="t2" style={{ lineHeight: 1.5 }}>AI writes a short summary of each report and notes on the links between PRs. Everything else works without it. Pick where the AI runs and which model to use.</span>
      </div>
      {providers.isLoading && <span className="t3" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading providers…</span>}
      {GROUPS.map(([g, label]) => {
        const items = (providers.data ?? []).filter((p) => p.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '6px 2px 6px' }}>{label}</div>
            <Grp role="radiogroup" aria-label={label}>
              {items.map((p) => {
                const on = a.provider === p.id;
                return (
                  <div key={p.id}>
                    <button className="grow prow" role="radio" aria-checked={on} onClick={() => !on && pick(p.id)} style={{ justifyContent: 'flex-start', opacity: on ? 1 : 0.75 }}>
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <button className="push" disabled={test.busy} onClick={() => void run()}>Test Connection</button>
        <TestResult test={test} />
      </div>
      <span className="t3" style={{ fontSize: 12 }}>Keys are stored in the system keychain. Secrets are removed from diffs before anything is sent, and AI text always carries the AI badge.</span>
    </>
  );
}

function BoardStep({ st, save, board, pick, test, setTest }: SettingsProps & TestProps & { board: Board; pick: (b: Board) => void }) {
  const s = useApp();
  const keys = ticketKeysOf(s.prs.map((p) => ({ title: p.title, branch: p.branch })), { ...st.boards.detect, bareAdoNumbers: false }).slice(0, 6);
  const found = (sys: 'ado' | 'jira') => keys.filter((k) => k.system === sys);
  const run = async () => {
    if (board === 'none') return;
    setTest({ busy: true });
    try {
      const r = await call('boards:test', { system: board });
      setTest({ busy: false, ok: r.ok, msg: r.message });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: errText(e) });
    }
  };
  const options: Array<[Board, string, string]> = [
    ['ado', 'Azure DevOps', found('ado').length ? `Found in your PRs: ${found('ado').map((k) => k.label).join(', ')}` : 'Work items such as AB#1234'],
    ['jira', 'Jira', found('jira').length ? `Found in your PRs: ${found('jira').map((k) => k.label).join(', ')}` : 'Issues such as PLAT-123'],
    ['none', 'Not now', 'Reports still find ticket numbers. They just can’t show the ticket’s title or acceptance criteria.'],
  ];
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ fontSize: 15 }}>Connect a ticket board</b>
        <span className="t2" style={{ lineHeight: 1.5 }}>PRsight reads the ticket behind each PR (read-only) so a report can check the change does what was asked.</span>
      </div>
      <Grp role="radiogroup" aria-label="Ticket board">
        {options.map(([id, name, sub]) => {
          const on = board === id;
          return (
            <div key={id}>
              <button className="grow prow" role="radio" aria-checked={on} onClick={() => !on && pick(id)} style={{ justifyContent: 'flex-start', opacity: on ? 1 : 0.75 }}>
                <span aria-hidden="true" className={on ? 'radio radio-on' : 'radio'} />
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, textAlign: 'left', flex: 1 }}><span style={{ fontWeight: on ? 600 : 400 }}>{name}</span><span className="t3" style={{ fontSize: 11.5 }}>{sub}</span></span>
              </button>
              {on && id === 'ado' && <AdoFields st={st} save={save} />}
              {on && id === 'jira' && <JiraFields st={st} save={save} />}
            </div>
          );
        })}
      </Grp>
      {board !== 'none' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          <button className="push" disabled={test.busy} onClick={() => void run()}>Test Connection</button>
          <TestResult test={test} />
        </div>
      )}
      <span className="t3" style={{ fontSize: 12 }}>You can connect both boards, and choose where ticket numbers are found, in Settings › Boards.</span>
    </>
  );
}

function modelLabel(st: S): string {
  const a = st.ai;
  if (a.provider === 'azureopenai') return a.azureOpenAI.deployment ? `deployment ${a.azureOpenAI.deployment}` : 'no deployment set';
  const m = a.models[a.provider];
  if (!m) return a.provider === 'claudecode' ? 'your Claude Code default model' : 'the default model';
  return a.provider === 'claudecode' ? CLI_LABELS[m] ?? m : m;
}

function DoneStep({ st, go }: SettingsProps & { go: (s: Step) => void }) {
  const providers = useQuery({ queryKey: ['providers', st.ai.provider], queryFn: () => call('ai:providers') });
  const pName = providers.data?.find((p) => p.id === st.ai.provider)?.name ?? st.ai.provider;
  const b = st.boards;
  const boards = [b.ado.enabled && `${BOARD_NAMES.ado}${b.ado.org ? ` · ${b.ado.org}` : ''}`, b.jira.enabled && `${BOARD_NAMES.jira}${b.jira.site ? ` · ${b.jira.site}` : ''}`].filter(Boolean).join(' and ');
  const rows: Array<[string, string, boolean, Step]> = [
    ['AI explanations', st.ai.enabled ? `On · ${pName} · ${modelLabel(st)}` : 'Off. Reports work without it.', st.ai.enabled, 'ai'],
    ['Ticket board', boards || 'Not connected. Ticket numbers are still found.', !!boards, 'boards'],
  ];
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ fontSize: 15 }}>You’re ready</b>
        <span className="t2" style={{ lineHeight: 1.5 }}>Tick the pull requests that belong together and choose Build Report. You can change any of this later in Settings.</span>
      </div>
      <Grp>
        {rows.map(([label, value, ok, to]) => (
          <div key={label} className="grow">
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, minWidth: 0 }}>
              <span>{label}</span>
              <span className="t3" style={{ fontSize: 11.5, color: ok ? 'var(--al)' : undefined }}>{ok ? '✓ ' : ''}{value}</span>
            </span>
            <button className="push" onClick={() => go(to)} aria-label={`Change ${label}`}>Change</button>
          </div>
        ))}
      </Grp>
    </>
  );
}
