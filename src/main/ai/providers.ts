// AI providers. Only providers the admin policy allows (settings.ai.allowed) can be used.
// The app never builds a Claude.ai login and never reads Claude Code's stored credentials:
// the Claude subscription path runs the official, unmodified `claude` CLI.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeStorage, shell } from 'electron';
import { eq } from 'drizzle-orm';
import { PublicClientApplication, type ICachePlugin } from '@azure/msal-node';
import { db, settingsT } from '../db';
import type { ProviderId, ProviderInfo } from '../../shared/ipc';
import { safeFetch } from '../net';
import { getSecret, getSettings } from '../settings';
import { PROMPTS, fill } from './prompts.config';

export const PROVIDERS: Array<Omit<ProviderInfo, 'status' | 'ready'>> = [
  { id: 'claudecode', name: 'Claude subscription (Claude Code)', sub: 'Runs the claude CLI you are signed in to. No API key.', group: 'subscription', needsKey: false },
  { id: 'foundry', name: 'Claude in Microsoft Foundry', sub: 'Your Foundry endpoint and API key. Data stays in your Azure tenant.', group: 'company', needsKey: true },
  { id: 'azureopenai', name: 'Azure OpenAI', sub: 'Your Azure OpenAI endpoint, deployment and API key.', group: 'company', needsKey: true },
  { id: 'bedrock', name: 'Amazon Bedrock', sub: 'Uses your AWS credentials (profile or SSO).', group: 'company', needsKey: false },
  { id: 'vertex', name: 'Google Vertex AI', sub: 'Uses your Google Cloud application default credentials.', group: 'company', needsKey: false },
  { id: 'anthropic', name: 'Anthropic API', sub: 'Your own API key.', group: 'key', needsKey: true },
  { id: 'openai', name: 'OpenAI', sub: 'Your own API key.', group: 'key', needsKey: true },
  { id: 'gemini', name: 'Google Gemini', sub: 'Your own API key.', group: 'key', needsKey: true },
];

const DEFAULT_MODELS: Record<ProviderId, string> = {
  claudecode: '', foundry: 'claude-sonnet-5-5', anthropic: 'claude-sonnet-5-5', bedrock: 'anthropic.claude-sonnet-5-5', vertex: 'claude-sonnet-5-5',
  openai: 'gpt-4.1', azureopenai: '', gemini: 'gemini-2.5-pro',
};

export const providerName = (id: ProviderId): string => PROVIDERS.find((p) => p.id === id)?.name ?? id;
const model = (id: ProviderId): string => getSettings().ai.models[id] || DEFAULT_MODELS[id];

let loginEnv: { env: Record<string, string>; bin: string | null } | null = null;

/**
 * GUI apps on macOS don't inherit your Terminal environment. Ask the login shell for it once,
 * so Claude Code runs with the same PATH and settings (for example CLAUDE_CONFIG_DIR) as in Terminal.
 */
/** The user's login-shell environment (PATH etc.), so CLIs installed with Homebrew and friends are found. */
export const loginShellEnv = (): Record<string, string> => ({ ...(process.env as Record<string, string>), ...shellLookup().env });

function shellLookup(): { env: Record<string, string>; bin: string | null; path: string } {
  if (!loginEnv) {
    const env: Record<string, string> = {};
    let bin: string | null = null;
    if (process.platform !== 'win32') {
      try {
        const shell = process.env.SHELL || '/bin/zsh';
        const out = execFileSync(shell, ['-ilc', 'command -v claude; echo "__ENV__"; env -0'], { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
        const [head, rest = ''] = out.split('__ENV__\n');
        const found = head.trim().split('\n').pop() ?? '';
        if (found.startsWith('/') && existsSync(found)) bin = found;
        for (const kv of rest.split('\0')) {
          const i = kv.indexOf('=');
          if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
        }
      } catch {
        /* fall back to the app's own environment */
      }
    }
    loginEnv = { env, bin };
  }
  return { ...loginEnv, path: loginEnv.env.PATH || process.env.PATH || '' };
}

/** The Claude Code CLI. The Claude desktop app on its own does not include it. */
export function claudeBin(): string | null {
  const candidates = [
    join(homedir(), '.claude', 'local', 'claude'),
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homedir(), '.npm-global', 'bin', 'claude'),
    join(homedir(), '.bun', 'bin', 'claude'),
    join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
  ];
  return shellLookup().bin ?? candidates.find((c) => existsSync(c)) ?? null;
}

export function providerInfo(): ProviderInfo[] {
  const s = getSettings();
  return PROVIDERS.filter((p) => s.ai.allowed.includes(p.id)).map((p) => {
    let ready = false;
    let status = 'Not set up';
    switch (p.id) {
      case 'claudecode':
        {
          const bin = claudeBin();
          ready = !!bin;
          status = bin ? `Using ${bin.replace(homedir(), '~')}` : 'Claude Code CLI not found';
        }
        break;
      case 'foundry':
        ready = !!(s.ai.foundry.endpoint && getSecret('foundry'));
        status = ready ? 'Ready' : 'Needs endpoint and API key';
        break;
      case 'azureopenai':
        ready = !!(s.ai.azureOpenAI.endpoint && s.ai.azureOpenAI.deployment && getSecret('azureopenai'));
        status = ready ? 'Ready' : 'Needs endpoint, deployment and API key';
        break;
      case 'bedrock':
        ready = true;
        status = `Region ${s.ai.bedrock.region}`;
        break;
      case 'vertex':
        ready = !!s.ai.vertex.projectId;
        status = ready ? `Project ${s.ai.vertex.projectId}` : 'Needs a project ID';
        break;
      default:
        ready = !!getSecret(p.id as 'anthropic' | 'openai' | 'gemini');
        status = ready ? 'Key saved' : 'Add a key';
    }
    return { ...p, ready, status };
  });
}

type JsonSchema = Record<string, unknown>;
const TOOL = PROMPTS.structured.toolName;

/**
 * Sends one request. When `schema` is given, the provider's structured-output feature is used so the reply
 * already follows the data model: a forced tool call for Claude (API, Foundry, Bedrock, Vertex),
 * response_format json_schema for OpenAI / Azure OpenAI, responseJsonSchema for Gemini.
 * The Claude Code CLI gets the schema in its system prompt. The reply is validated again afterwards either way.
 */
export async function complete(system: string, user: string, schema?: JsonSchema): Promise<string> {
  const s = getSettings();
  const id = s.ai.provider;
  if (!s.ai.allowed.includes(id)) throw new Error('Your administrator has not allowed this AI provider.');
  switch (id) {
    case 'claudecode':
      return claudeCli(schema ? fill(PROMPTS.structured.cliSystem, { system, schema: JSON.stringify(schema) }) : system, user);
    case 'anthropic':
      return anthropicMessages('https://api.anthropic.com/v1/messages', { 'x-api-key': need('anthropic'), 'anthropic-version': '2023-06-01' }, system, user, model(id), schema);
    case 'foundry': {
      const ep = s.ai.foundry.endpoint.replace(/\/+$/, '');
      const url = /\/messages$/.test(ep) ? ep : `${ep}/anthropic/v1/messages`;
      const key = need('foundry');
      return anthropicMessages(url, { 'x-api-key': key, 'api-key': key, 'anthropic-version': '2023-06-01' }, system, user, model(id), schema);
    }
    case 'openai':
      return openaiChat('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${need('openai')}` }, system, user, model(id), schema);
    case 'azureopenai': {
      const a = s.ai.azureOpenAI;
      const url = `${a.endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(a.deployment)}/chat/completions?api-version=2024-10-21`;
      return openaiChat(url, { 'api-key': need('azureopenai') }, system, user, undefined, schema);
    }
    case 'gemini':
      return gemini(system, user, schema);
    case 'bedrock':
      return sdkMessages('bedrock', system, user, schema);
    case 'vertex':
      return sdkMessages('vertex', system, user, schema);
  }
}

export async function testProvider(id: ProviderId): Promise<{ ok: boolean; message: string }> {
  const s = getSettings();
  const prev = s.ai.provider;
  try {
    s.ai.provider = id;
    const out = await complete(PROMPTS.test.system, PROMPTS.test.user);
    return { ok: /ok/i.test(out), message: /ok/i.test(out) ? 'Connected' : `Unexpected reply: ${out.slice(0, 80)}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    s.ai.provider = prev;
  }
}

function need(name: 'anthropic' | 'openai' | 'gemini' | 'azureopenai' | 'foundry'): string {
  const k = getSecret(name);
  if (!k) throw new Error('No API key saved for this provider.');
  return k;
}

type ClaudeBlock = { type: string; text?: string; name?: string; input?: unknown };
const claudeTools = (schema?: JsonSchema) =>
  schema ? { tools: [{ name: TOOL, description: PROMPTS.structured.toolDescription, input_schema: schema }], tool_choice: { type: 'tool', name: TOOL } } : {};
const claudeText = (blocks: ClaudeBlock[]): string => {
  const tool = blocks.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (tool) return JSON.stringify(tool.input);
  return blocks.filter((c) => c.type === 'text').map((c) => c.text).join('');
};

async function anthropicMessages(url: string, auth: Record<string, string>, system: string, user: string, m: string, schema?: JsonSchema): Promise<string> {
  const res = await safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ model: m, max_tokens: 4000, system, messages: [{ role: 'user', content: user }], ...claudeTools(schema) }) });
  const j = (await res.json()) as { content?: ClaudeBlock[]; error?: { message: string } };
  if (!res.ok) throw new Error(j.error?.message ?? `AI provider returned ${res.status}`);
  return claudeText(j.content ?? []);
}

async function openaiChat(url: string, auth: Record<string, string>, system: string, user: string, m: string | undefined, schema?: JsonSchema): Promise<string> {
  const response_format = schema ? { type: 'json_schema', json_schema: { name: TOOL, schema, strict: false } } : { type: 'json_object' };
  const res = await safeFetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ ...(m ? { model: m } : {}), response_format, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const j = (await res.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (!res.ok) throw new Error(j.error?.message ?? `AI provider returned ${res.status}`);
  return j.choices?.[0]?.message.content ?? '';
}

async function gemini(system: string, user: string, schema?: JsonSchema): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model('gemini'))}:generateContent`;
  const res = await safeFetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': need('gemini') },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', ...(schema ? { responseJsonSchema: schema } : {}) } }),
  });
  const j = (await res.json()) as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }>; error?: { message: string } };
  if (!res.ok) throw new Error(j.error?.message ?? `AI provider returned ${res.status}`);
  return j.candidates?.[0]?.content.parts.map((p) => p.text).join('') ?? '';
}

async function sdkMessages(kind: 'bedrock' | 'vertex', system: string, user: string, schema?: JsonSchema): Promise<string> {
  const s = getSettings();
  // Optional dependencies, loaded only when chosen. They use the standard AWS / Google credential chains.
  type Client = { messages: { create: (a: unknown) => Promise<{ content: ClaudeBlock[] }> } };
  let client: Client;
  if (kind === 'bedrock') {
    const name = '@anthropic-ai/bedrock-sdk';
    const mod = (await import(/* @vite-ignore */ name)) as { AnthropicBedrock: new (o: unknown) => Client };
    client = new mod.AnthropicBedrock({ awsRegion: s.ai.bedrock.region });
  } else {
    const name = '@anthropic-ai/vertex-sdk';
    const mod = (await import(/* @vite-ignore */ name)) as { AnthropicVertex: new (o: unknown) => Client };
    client = new mod.AnthropicVertex({ projectId: s.ai.vertex.projectId, region: s.ai.vertex.region });
  }
  const r = await client.messages.create({ model: model(kind), max_tokens: 4000, system, messages: [{ role: 'user', content: user }], ...claudeTools(schema) });
  return claudeText(r.content);
}

function claudeCli(system: string, user: string): Promise<string> {
  const bin = claudeBin();
  if (!bin) return Promise.reject(new Error('The Claude Code command-line tool (claude) was not found. The Claude desktop app does not include it: install Claude Code, run `claude` once in Terminal to sign in with your subscription, then try again.'));
  const login = shellLookup();
  const env: Record<string, string | undefined> = { ...process.env, ...login.env, PATH: login.path };
  // Electron's own variables can confuse a Node-based CLI.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RENDERER_URL;
  const args = ['-p', '--output-format', 'json', '--append-system-prompt', system];
  const m = getSettings().ai.models.claudecode;
  if (m) args.push('--model', m);
  return new Promise((resolve, reject) => {
    // Run outside any project folder so Claude Code doesn't pick up a repo's CLAUDE.md or settings.
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 240_000, env, cwd: tmpdir() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`Could not start Claude Code: ${e.message}`)));
    child.on('close', (code, signal) => {
      let j: { result?: string; is_error?: boolean; subtype?: string } | null = null;
      try {
        j = JSON.parse(out.trim()) as { result?: string; is_error?: boolean; subtype?: string };
      } catch {
        j = null;
      }
      if (code === 0 && j && !j.is_error) return resolve(j.result ?? '');
      if (code === 0 && !j) return resolve(out);
      const reason = (j?.result || err.trim().split('\n').filter(Boolean).pop() || out.trim().split('\n').filter(Boolean).pop() || '').slice(0, 400);
      console.error(`[prsight] claude exited with ${code ?? signal}\nstdout: ${out.slice(0, 2000)}\nstderr: ${err.slice(0, 2000)}`);
      if (signal === 'SIGTERM') return reject(new Error('Claude Code took too long (over 4 minutes) and was stopped. Try again, or pick a smaller set of PRs.'));
      if (/not logged in|please run \/login|invalid api key|authentication/i.test(reason)) return reject(new Error(`Claude Code says it is not signed in (${reason}). It ran ${bin}. If that is not the claude you use in Terminal, run \`which claude\` there and tell us.`));
      reject(new Error(reason ? `Claude Code: ${reason}` : `Claude Code exited with code ${code} and no message. Run \`claude -p "say OK"\` in Terminal to check it works.`));
    });
    child.stdin.end(user);
  });
}

// ---------- Entra ID (MSAL) for Azure DevOps ----------
// The sign-in is kept between launches, encrypted with the system keychain (safeStorage),
// so lookups sign in silently; the browser opens only when that saved sign-in has expired.
const pcas = new Map<string, PublicClientApplication>();
const SIGN_IN_TIMEOUT = 120_000;

function msalCache(key: string): ICachePlugin {
  const row = `msal:${key}`;
  return {
    beforeCacheAccess: async (ctx) => {
      const r = db().select().from(settingsT).where(eq(settingsT.key, row)).get();
      if (!r || !safeStorage.isEncryptionAvailable()) return;
      try {
        ctx.tokenCache.deserialize(safeStorage.decryptString(Buffer.from(r.value, 'base64')));
      } catch {
        /* unreadable (for example a different user): sign in again */
      }
    },
    afterCacheAccess: async (ctx) => {
      if (!ctx.cacheHasChanged || !safeStorage.isEncryptionAvailable()) return;
      const value = safeStorage.encryptString(ctx.tokenCache.serialize()).toString('base64');
      db().insert(settingsT).values({ key: row, value }).onConflictDoUpdate({ target: settingsT.key, set: { value } }).run();
    },
  };
}

export async function entraToken(tenantId: string, clientId: string, scope: string): Promise<string> {
  if (!tenantId || !clientId) throw new Error('Set the Entra tenant and app (client) ID in Settings › Boards first.');
  const key = `${tenantId}:${clientId}`;
  let pca = pcas.get(key);
  if (!pca) {
    pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin: msalCache(key) } });
    pcas.set(key, pca);
  }
  const [account] = await pca.getTokenCache().getAllAccounts();
  if (account) {
    try {
      const r = await pca.acquireTokenSilent({ account, scopes: [scope] });
      if (r?.accessToken) return r.accessToken;
    } catch (e) {
      console.log('[prsight] saved Entra sign-in could not be used, signing in again:', (e as Error).message);
    }
  }
  console.log('[prsight] opening the browser to sign in to Azure DevOps');
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_r, reject) => {
    timer = setTimeout(() => reject(new Error('Azure DevOps sign-in timed out. Finish signing in in the browser, then rebuild the report.')), SIGN_IN_TIMEOUT);
  });
  try {
    const r = await Promise.race([
      pca.acquireTokenInteractive({
        scopes: [scope],
        openBrowser: async (url) => {
          await shell.openExternal(url);
        },
        successTemplate: '<p>Signed in. You can close this tab and go back to PRsight.</p>',
        errorTemplate: '<p>Sign-in failed: {error}</p>',
      }),
      timeout,
    ]);
    return r.accessToken;
  } finally {
    clearTimeout(timer);
  }
}

/** Known model IDs for providers that have no model list API we can call with the app's sign-in. */
const KNOWN_MODELS: Partial<Record<ProviderId, string[]>> = {
  // Claude Code CLI aliases always point at the current model of that family.
  claudecode: ['opus', 'sonnet', 'haiku'],
  foundry: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  vertex: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  bedrock: ['anthropic.claude-opus-5-5', 'anthropic.claude-sonnet-5-5', 'anthropic.claude-haiku-5-5'],
};

/** Models to offer in Settings › AI. Live from the provider when a key is saved, otherwise a known list. */
export async function listModels(id: ProviderId): Promise<{ models: string[]; default: string; source: 'live' | 'known' | 'none'; note?: string }> {
  const def = DEFAULT_MODELS[id];
  const known = (note?: string) => ({ models: KNOWN_MODELS[id] ?? [], default: def, source: (KNOWN_MODELS[id] ? 'known' : 'none') as 'known' | 'none', note });
  try {
    if (id === 'anthropic') {
      const k = getSecret('anthropic');
      if (!k) return { models: [], default: def, source: 'none', note: 'Save an API key to load the model list.' };
      const res = await safeFetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } });
      const j = (await res.json()) as { data?: Array<{ id: string }>; error?: { message: string } };
      if (!res.ok) throw new Error(j.error?.message ?? `Provider returned ${res.status}`);
      return { models: (j.data ?? []).map((m) => m.id), default: def, source: 'live' };
    }
    if (id === 'openai') {
      const k = getSecret('openai');
      if (!k) return { models: [], default: def, source: 'none', note: 'Save an API key to load the model list.' };
      const res = await safeFetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` } });
      const j = (await res.json()) as { data?: Array<{ id: string }>; error?: { message: string } };
      if (!res.ok) throw new Error(j.error?.message ?? `Provider returned ${res.status}`);
      const chat = (j.data ?? []).map((m) => m.id).filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m) && !/audio|realtime|tts|transcribe|image|embedding|search|instruct/.test(m));
      return { models: chat.sort().reverse(), default: def, source: 'live' };
    }
    if (id === 'gemini') {
      const k = getSecret('gemini');
      if (!k) return { models: [], default: def, source: 'none', note: 'Save an API key to load the model list.' };
      const res = await safeFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': k } });
      const j = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }>; error?: { message: string } };
      if (!res.ok) throw new Error(j.error?.message ?? `Provider returned ${res.status}`);
      const names = (j.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
      return { models: names.filter((n) => /^gemini/.test(n)).sort().reverse(), default: def, source: 'live' };
    }
    if (id === 'azureopenai') return { models: [], default: def, source: 'none', note: 'Azure OpenAI uses the deployment name above as the model.' };
    return known();
  } catch (e) {
    return { ...known(), note: `Couldn’t load the list: ${(e as Error).message}` };
  }
}
