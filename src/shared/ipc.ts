// Every IPC channel is declared here with Zod schemas for its input.
// The preload exposes only these channels; the main process validates every call.
import { z } from 'zod';
import type { PrState, PrSummary, Report } from './model';
import type { HygieneCheck } from '../analysis/prHygiene';

export const PrRefZ = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100), number: z.number().int().positive() });
export const ScopeZ = z.enum(['all', 'assigned', 'mine', 'drafts']);
export const StateFilterZ = z.enum(['open', 'closed']);
export const ReviewEventZ = z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
export const DiffSideZ = z.enum(['LEFT', 'RIGHT']);
export const LineCommentZ = z.object({
  path: z.string().min(1).max(1000),
  line: z.number().int().positive(),
  side: DiffSideZ,
  startLine: z.number().int().positive().optional(),
  startSide: DiffSideZ.optional(),
  body: z.string().min(1).max(20000),
});
export type LineComment = z.infer<typeof LineCommentZ>;

export const ProviderIdZ = z.enum(['claudecode', 'foundry', 'anthropic', 'openai', 'azureopenai', 'gemini', 'bedrock', 'vertex']);
export type ProviderId = z.infer<typeof ProviderIdZ>;

export const SettingsZ = z.object({
  appearance: z.enum(['system', 'light', 'dark']).default('system'),
  /** Whole-window zoom: layout and text scale together. */
  zoom: z.number().min(0.5).max(2).default(1),
  refreshMinutes: z.number().int().min(0).max(60).default(2),
  refreshOnlyActive: z.boolean().default(true),
  /** GitHub organisation to list PRs and repos from. Blank: your own account. */
  org: z.string().default(''),
  repos: z.array(z.string()).default([]),
  /** Repos pinned to the top of the sidebar (in addition to your GitHub stars). */
  pinnedRepos: z.array(z.string().max(200)).max(200).default([]),
  github: z.object({ clientId: z.string().default(''), host: z.string().default('github.com') }).default({ clientId: '', host: 'github.com' }),
  ai: z
    .object({
      enabled: z.boolean().default(false),
      provider: ProviderIdZ.default('claudecode'),
      models: z.record(z.string(), z.string()).default({}),
      // Foundry and Azure OpenAI use an API key (kept in the system keychain), not Entra sign-in.
      foundry: z.object({ endpoint: z.string().default('') }).default({ endpoint: '' }),
      azureOpenAI: z.object({ endpoint: z.string().default(''), deployment: z.string().default('') }).default({ endpoint: '', deployment: '' }),
      bedrock: z.object({ region: z.string().default('eu-west-1') }).default({ region: 'eu-west-1' }),
      vertex: z.object({ projectId: z.string().default(''), region: z.string().default('europe-west1') }).default({ projectId: '', region: 'europe-west1' }),
      allowed: z.array(ProviderIdZ).default(['claudecode', 'foundry', 'anthropic', 'openai', 'azureopenai', 'gemini', 'bedrock', 'vertex']),
    })
    .prefault({}),
  boards: z
    .object({
      ado: z.object({ enabled: z.boolean().default(false), auth: z.enum(['azcli', 'pat', 'entra']).default('azcli'), org: z.string().default(''), project: z.string().default(''), team: z.string().default(''), tenantId: z.string().default(''), clientId: z.string().default('') }).prefault({}),
      jira: z.object({ enabled: z.boolean().default(false), site: z.string().default(''), email: z.string().default(''), projectKeys: z.array(z.string()).default([]) }).prefault({}),
      detect: z.object({ title: z.boolean().default(true), branch: z.boolean().default(true), description: z.boolean().default(true), commits: z.boolean().default(true) }).prefault({}),
    })
    .prefault({}),
  privacy: z
    .object({
      keepFileCopies: z.boolean().default(true),
      keepDays: z.number().int().min(1).max(365).default(14),
      updateCheck: z.enum(['off', 'daily', 'weekly']).default('daily'),
      updateFeed: z.string().default(''),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof SettingsZ>;

export const SecretNameZ = z.enum(['github', 'anthropic', 'openai', 'azureopenai', 'foundry', 'gemini', 'jira', 'ado']);
export type SecretName = z.infer<typeof SecretNameZ>;

export interface PrListItem {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  draft: boolean;
  state: PrState;
  branch: string;
  base: string;
  url: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  updatedAt: string;
  reviewRequested: boolean;
  teamRequested: boolean;
  mine: boolean;
  hasDescription: boolean;
  hasTicket: boolean;
}

export interface CodeLine {
  a: number | null;
  b: number | null;
  type: '+' | '-' | ' ';
  text: string;
}

export interface ThreadMessage {
  id: number;
  author: string;
  isBot: boolean;
  aiReviewer: boolean;
  body: string;
  createdAt: string;
}

export interface ReviewThreadView {
  id: number;
  path: string;
  line: number | null;
  outdated: boolean;
  resolved: boolean;
  /** GraphQL id of the thread, used to resolve or unresolve it. */
  threadId?: string;
  code: CodeLine[];
  messages: ThreadMessage[];
}

export interface PrFileView {
  path: string;
  previous?: string;
  status: string;
  additions: number;
  deletions: number;
  /** null when GitHub sends no text diff (binary or too large). */
  patch: string | null;
}

/** Live state of a PR: open/draft/merged, review decision, checks and conflicts. */
export interface PrStatus {
  state: 'open' | 'draft' | 'merged' | 'closed';
  review: 'approved' | 'changes' | 'required' | 'none';
  approvals: number;
  checks: 'passing' | 'failing' | 'running' | 'none';
  conflicts: boolean;
}

export interface PrFilesView {
  headSha: string;
  files: PrFileView[];
}

export interface PrDetails {
  pr: PrSummary & { id: string };
  threads: ReviewThreadView[];
  conversation: ThreadMessage[];
  viewer: string;
  myReview: { state: string; at: string } | null;
  /** Title and description checks (empty, template-only, stale, against the team rules). */
  hygiene: HygieneCheck[];
}

export interface AuthStatus {
  signedIn: boolean;
  login?: string;
  via?: 'device' | 'gh' | 'token';
  clientIdConfigured: boolean;
}

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

export interface ReportListItem {
  id: string;
  title: string;
  createdAt: string;
  prIds: string[];
  stale: boolean;
}

export interface StorageUsage {
  cacheBytes: number;
  reports: number;
  memoryNotes: number;
  path: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  sub: string;
  group: 'subscription' | 'company' | 'key';
  needsKey: boolean;
  status: string;
  ready: boolean;
}

export interface BuildProgress {
  step: number;
  total: number;
  label: string;
}

/** Channels: [input schema, output type]. */
export const Channels = {
  'auth:status': z.void(),
  'auth:startDevice': z.void(),
  'auth:pollDevice': z.object({ deviceCode: z.string(), interval: z.number() }),
  'auth:useGhCli': z.void(),
  'auth:useToken': z.object({ token: z.string().min(20).max(400) }),
  'auth:signOut': z.void(),

  'prs:list': z.object({ scope: ScopeZ, state: StateFilterZ, q: z.string().max(200).default(''), repo: z.string().max(200).optional() }),
  'prs:cached': z.object({ scope: ScopeZ, state: StateFilterZ, q: z.string().max(200).default(''), repo: z.string().max(200).optional() }),
  'prs:details': PrRefZ,
  'prs:reply': z.object({ ref: PrRefZ, commentId: z.number().int(), body: z.string().min(1).max(20000) }),
  'prs:comment': z.object({ ref: PrRefZ, body: z.string().min(1).max(20000) }),
  'prs:review': z.object({
    ref: PrRefZ,
    event: ReviewEventZ,
    body: z.string().max(20000),
    /** Line comments sent with the review (GitHub's "Start a review"). */
    comments: z.array(LineCommentZ).max(100).optional(),
    /** The commit the line numbers refer to (the PR head when the diff was loaded). */
    commitId: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  }),
  'prs:files': PrRefZ,
  'prs:resolve': z.object({ threadId: z.string().min(4).max(200).regex(/^[A-Za-z0-9_=-]+$/), resolve: z.boolean() }),
  'prs:status': z.object({ refs: z.array(PrRefZ).min(1).max(10) }),
  'repos:refresh': z.void(),
  'avatars:get': z.object({ logins: z.array(z.string().min(1).max(100)).max(100) }),
  'repos:favourites': z.void(),
  'repos:all': z.object({ offset: z.number().int().min(0), limit: z.number().int().min(1).max(10000) }),
  'prs:related': z.object({ selected: z.array(z.string()), all: z.array(z.string()), state: z.enum(['open', 'closed']).default('open') }),

  'report:build': z.object({ refs: z.array(PrRefZ).min(1).max(10), manualTickets: z.array(z.string().max(30)).max(20).default([]) }),
  'report:list': z.void(),
  'report:get': z.object({ id: z.string() }),
  'report:delete': z.object({ id: z.string() }),
  'report:explain': z.object({ id: z.string() }),
  'report:diff': z.object({ ref: PrRefZ, paths: z.array(z.string()).max(50) }),

  'settings:get': z.void(),
  // A partial patch. Not parsed with SettingsZ here: Zod would fill in defaults for every missing field
  // and the save would reset other settings (such as AI) to off. The merged result is validated in main.
  'settings:set': z.record(z.string(), z.unknown()),
  'secrets:set': z.object({ name: SecretNameZ, value: z.string().min(1).max(4000) }),
  'secrets:has': z.void(),
  'secrets:delete': z.object({ name: SecretNameZ }),

  'ai:providers': z.void(),
  'ai:test': z.object({ provider: ProviderIdZ }),
  'ai:models': z.object({ provider: ProviderIdZ }),
  'repos:search': z.object({ q: z.string().min(1).max(100) }),

  'boards:test': z.object({ system: z.enum(['ado', 'jira']) }),

  'data:usage': z.void(),
  'data:clear': z.object({ what: z.enum(['cache', 'reports', 'memory']) }),
  'data:deleteAll': z.void(),

  'app:openExternal': z.object({ url: z.string().url() }),
  'app:info': z.void(),

  'update:get': z.void(),
  'update:check': z.void(),
  'update:download': z.void(),
  'update:install': z.void(),
} as const;

export type Channel = keyof typeof Channels;
export type Input<C extends Channel> = z.input<(typeof Channels)[C]>;

export interface Outputs {
  'auth:status': AuthStatus;
  'auth:startDevice': DeviceCode;
  'auth:pollDevice': { done: boolean; error?: string; status?: AuthStatus };
  'auth:useGhCli': AuthStatus;
  'auth:useToken': AuthStatus;
  'auth:signOut': AuthStatus;
  'prs:list': PrListItem[];
  'prs:cached': { at: number; items: PrListItem[] } | null;
  'prs:details': PrDetails;
  'prs:reply': { ok: true };
  'prs:comment': { ok: true };
  'prs:review': { ok: true; state: string };
  'prs:files': PrFilesView;
  'prs:resolve': { resolved: boolean };
  'prs:status': Record<string, PrStatus>;
  'repos:refresh': { count: number };
  'avatars:get': Record<string, string>;
  'repos:favourites': { starred: string[]; pinned: string[] };
  'repos:all': { names: string[]; total: number };
  /** Related PRs (same ticket), the list items for any not in the current list, and the ticket keys searched. */
  'prs:related': { related: Array<{ id: string; reason: string }>; items: PrListItem[]; keys: string[] };
  'report:build': Report;
  'report:list': ReportListItem[];
  'report:get': Report | null;
  'report:delete': { ok: true };
  'report:explain': Report;
  'report:diff': Record<string, { patch: string | null; status: string }>;
  'settings:get': Settings;
  'settings:set': Settings;
  'secrets:set': { ok: true };
  'secrets:has': Record<SecretName, boolean>;
  'secrets:delete': { ok: true };
  'ai:providers': ProviderInfo[];
  'ai:test': { ok: boolean; message: string };
  'ai:models': { models: string[]; default: string; source: 'live' | 'known' | 'none'; note?: string };
  'repos:search': string[];
  'boards:test': { ok: boolean; message: string };
  'data:usage': StorageUsage;
  'data:clear': { ok: true };
  'data:deleteAll': { ok: true };
  'app:openExternal': { ok: boolean };
  'app:info': { platform: NodeJS.Platform | string; version: string; keychain: string; dataPath: string };
  'update:get': UpdateState;
  'update:check': UpdateState;
  'update:download': { ok: true };
  'update:install': { ok: true };
}

/** Where the app is with updates. `manual`: the person asked (show results even when there's nothing new). */
export type UpdateState = { current: string; manual: boolean } & (
  | { status: 'idle' | 'checking' }
  | { status: 'none'; checkedAt: string }
  | { status: 'available'; version: string; notes: string; canInstall: boolean; url: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }
);

export type Events = {
  'report:progress': BuildProgress;
  'menu:command': { command: string };
  'settings:changed': Partial<Settings>;
  'update:state': UpdateState;
};

export interface Api {
  invoke<C extends Channel>(channel: C, input?: Input<C>): Promise<Outputs[C]>;
  on<E extends keyof Events>(event: E, cb: (payload: Events[E]) => void): () => void;
  platform: string;
}
