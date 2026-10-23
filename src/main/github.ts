// GitHub REST + GraphQL client. Reads with ETag caching; writes only to the comment, reply and review endpoints.
import type { LineComment, PrFilesView, PrStatus, PrListItem, PrDetails, ReviewThreadView, ThreadMessage } from '../shared/ipc';
import type { PrRef, PrSnapshot, PrSummary } from '../shared/model';
import { prId } from '../shared/model';
import { tailOfHunk } from '../analysis/diff';
import { isAiReviewer } from '../analysis/findings';
import { findTicketKeys, DEFAULT_DETECT } from '../analysis/tickets';
import { isTestPath } from '../analysis/classify';
import { RULE_FILE_NAMES } from '../analysis/teamRules';
import { checkPrHygiene, type HygieneCheck } from '../analysis/prHygiene';
import { cacheGet, cachePut } from './db';
import { safeFetch } from './net';
import { getSecret, getSettings } from './settings';

export class GitHubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const apiBase = (): string => {
  const host = getSettings().github.host || 'github.com';
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
};
const graphqlUrl = (): string => {
  const host = getSettings().github.host || 'github.com';
  return host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`;
};

function token(): string {
  const t = getSecret('github');
  if (!t) throw new GitHubError('Not signed in to GitHub', 401);
  return t;
}

const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `Bearer ${token()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'prsight',
  ...extra,
});

/** GET with ETag caching. 304 responses are served from the local cache and don't count against the rate limit. */
export async function ghGet<T>(path: string, opts: { raw?: boolean; cache?: boolean } = {}): Promise<T> {
  const url = path.startsWith('http') ? path : apiBase() + path;
  const key = (opts.raw ? 'raw:' : 'json:') + url;
  // File copies are only cached when "Keep copies of changed files" is on.
  const useCache = opts.cache !== false && (!opts.raw || getSettings().privacy.keepFileCopies);
  const cached = useCache ? cacheGet(key) : null;
  const res = await safeFetch(url, { headers: headers({ ...(opts.raw ? { Accept: 'application/vnd.github.raw' } : {}), ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) }) });
  if (res.status === 304 && cached) return (opts.raw ? cached.body : JSON.parse(cached.body)) as T;
  if (res.status === 404) throw new GitHubError('Not found', 404);
  if (!res.ok) throw new GitHubError(await errorText(res), res.status);
  const body = await res.text();
  if (useCache) cachePut(key, res.headers.get('etag'), body);
  return (opts.raw ? body : JSON.parse(body)) as T;
}

async function ghPaged<T>(path: string, max = 300): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < max; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await ghGet<T[]>(`${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.slice(0, max);
}

async function ghSend<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  // The only write endpoints the app uses: issue comments, review comment replies and reviews.
  if (!/^\/repos\/[^/]+\/[^/]+\/(issues\/\d+\/comments|pulls\/\d+\/comments\/\d+\/replies|pulls\/\d+\/reviews)$/.test(path)) throw new GitHubError('Write endpoint not allowed', 403);
  const res = await safeFetch(apiBase() + path, { method, headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (!res.ok) throw new GitHubError(await errorText(res), res.status);
  return (await res.json()) as T;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await safeFetch(graphqlUrl(), { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new GitHubError(await errorText(res), res.status);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new GitHubError(json.errors.map((e) => e.message).join('; '), 400);
  return json.data as T;
}

async function errorText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string };
    return j.message ?? `GitHub returned ${res.status}`;
  } catch {
    return `GitHub returned ${res.status}`;
  }
}

let viewerLogin: string | null = null;
export async function viewer(): Promise<string> {
  if (viewerLogin) return viewerLogin;
  const u = await ghGet<{ login: string }>('/user', { cache: false });
  viewerLogin = u.login;
  return u.login;
}
export const forgetViewer = (): void => {
  viewerLogin = null;
};

// ---------------- PR list ----------------

const SEARCH = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 60) {
    nodes {
      ... on PullRequest {
        number title url isDraft state merged body headRefName baseRefName additions deletions changedFiles updatedAt
        author { login }
        repository { name owner { login } }
        reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
      }
    }
  }
}`;

interface SearchNode {
  number: number; title: string; url: string; isDraft: boolean; state: 'OPEN' | 'CLOSED' | 'MERGED'; merged: boolean; body: string;
  headRefName: string; baseRefName: string; additions: number; deletions: number; changedFiles: number; updatedAt: string;
  author: { login: string } | null; repository: { name: string; owner: { login: string } };
  reviewRequests: { nodes: Array<{ requestedReviewer: { __typename: string; login?: string; slug?: string } | null }> };
}

export async function listPrs(scope: 'all' | 'assigned' | 'mine' | 'drafts', state: 'open' | 'closed', q: string, repo?: string): Promise<PrListItem[]> {
  const s = getSettings();
  const me = await viewer();
  const one = repo?.replace(/[^\w./-]/g, '');
  const own = s.org.trim() || me;
  const where = one ? `repo:${one.includes('/') ? one : `${own}/${one}`}` : s.repos.length ? s.repos.map((r) => `repo:${r.includes('/') ? r : `${own}/${r}`}`).join(' ') : s.org.trim() ? `org:${own}` : `user:${own}`;
  const scopeQ = { all: '', assigned: 'review-requested:@me', team: 'review-requested:@me', mine: 'author:@me', drafts: 'draft:true author:@me' }[scope];
  const query = `is:pr ${state === 'open' ? 'is:open' : 'is:closed'} archived:false ${where} ${scopeQ} ${q.replace(/[^\w\s#:/.-]/g, ' ')} sort:updated-desc`.replace(/\s+/g, ' ').trim();
  const data = await graphql<{ search: { nodes: SearchNode[] } }>(SEARCH, { q: query });
  const items = data.search.nodes.filter((n) => n && n.number).map((n): PrListItem => {
    const reqs = n.reviewRequests.nodes.map((x) => x.requestedReviewer).filter(Boolean) as Array<{ __typename: string; login?: string }>;
    const direct = reqs.some((r) => r.__typename === 'User' && r.login === me);
    const teamReq = reqs.some((r) => r.__typename === 'Team');
    const keys = [...findTicketKeys(n.title, 'title', DEFAULT_DETECT), ...findTicketKeys(n.headRefName, 'branch', DEFAULT_DETECT), ...findTicketKeys(n.body ?? '', 'description', DEFAULT_DETECT)];
    return {
      id: `${n.repository.owner.login}/${n.repository.name}#${n.number}`, owner: n.repository.owner.login, repo: n.repository.name, number: n.number, title: n.title,
      author: n.author?.login ?? 'ghost', draft: n.isDraft, state: n.merged ? 'merged' : n.state === 'OPEN' ? 'open' : 'closed', branch: n.headRefName, base: n.baseRefName,
      url: n.url, body: n.body ?? '', additions: n.additions, deletions: n.deletions, changedFiles: n.changedFiles, updatedAt: n.updatedAt,
      reviewRequested: direct, teamRequested: teamReq && !direct, mine: n.author?.login === me, hasDescription: !!(n.body ?? '').trim(), hasTicket: keys.length > 0,
    };
  });
  if (scope === 'assigned') return items.filter((i) => i.reviewRequested);
  return items;
}

// ---------------- PR details ----------------

interface RestPull {
  number: number; title: string; body: string | null; draft: boolean; state: string; merged_at: string | null; html_url: string;
  user: { login: string }; head: { ref: string; sha: string }; base: { ref: string };
  additions: number; deletions: number; changed_files: number; updated_at: string;
  requested_reviewers: Array<{ login: string }>; requested_teams: Array<{ slug: string }>;
}
interface RestReviewComment { id: number; in_reply_to_id?: number; path: string; line: number | null; original_line: number | null; diff_hunk: string; user: { login: string; type: string }; body: string; created_at: string }
interface RestIssueComment { id: number; user: { login: string; type: string }; body: string; created_at: string }
interface RestReview { user: { login: string }; state: string; submitted_at: string }

const toSummary = (o: string, r: string, p: RestPull): PrSummary => ({
  owner: o, repo: r, number: p.number, title: p.title, author: p.user.login, draft: p.draft, state: p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed',
  branch: p.head.ref, base: p.base.ref, url: p.html_url, body: p.body ?? '', additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files,
  updatedAt: p.updated_at, headSha: p.head.sha, requestedReviewers: p.requested_reviewers.map((u) => u.login), requestedTeams: p.requested_teams.map((t) => t.slug),
});

const THREADS = `query($o: String!, $r: String!, $n: Int!) {
  repository(owner: $o, name: $r) { pullRequest(number: $n) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } }
}`;

/** Per root review comment id: whether its thread is resolved, and the thread's GraphQL id (for Resolve). */
async function threadInfo(ref: PrRef): Promise<Record<string, { resolved: boolean; threadId: string }>> {
  try {
    const d = await graphql<{ repository: { pullRequest: { reviewThreads: { nodes: Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ databaseId: number }> } }> } } } }>(THREADS, { o: ref.owner, r: ref.repo, n: ref.number });
    const out: Record<string, { resolved: boolean; threadId: string }> = {};
    for (const t of d.repository.pullRequest.reviewThreads.nodes) {
      const id = t.comments.nodes[0]?.databaseId;
      if (id) out[String(id)] = { resolved: t.isResolved, threadId: t.id };
    }
    return out;
  } catch {
    return {};
  }
}

async function resolvedMap(ref: PrRef): Promise<Record<string, boolean>> {
  return Object.fromEntries(Object.entries(await threadInfo(ref)).map(([k, v]) => [k, v.resolved]));
}

/** Resolve or unresolve one review thread. The only GraphQL writes the app makes. */
export async function setThreadResolved(threadId: string, resolve: boolean): Promise<boolean> {
  const m = resolve
    ? 'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }'
    : 'mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }';
  const d = await graphql<Record<string, { thread: { isResolved: boolean } }>>(m, { id: threadId });
  return Object.values(d)[0]?.thread.isResolved ?? resolve;
}

const isBot = (u: { login: string; type: string }) => u.type === 'Bot' || /\[bot]$/.test(u.login) || /^copilot/i.test(u.login);

export async function prDetails(ref: PrRef): Promise<PrDetails> {
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const [p, rc, ic, reviews, resolved, me] = await Promise.all([
    ghGet<RestPull>(`${base}/pulls/${ref.number}`),
    ghPaged<RestReviewComment>(`${base}/pulls/${ref.number}/comments`),
    ghPaged<RestIssueComment>(`${base}/issues/${ref.number}/comments`),
    ghPaged<RestReview>(`${base}/pulls/${ref.number}/reviews`),
    threadInfo(ref),
    viewer(),
  ]);
  const msg = (c: { id: number; user: { login: string; type: string }; body: string; created_at: string }): ThreadMessage => ({
    id: c.id, author: c.user.login, isBot: isBot(c.user), aiReviewer: isAiReviewer(c.user.login), body: c.body, createdAt: c.created_at,
  });
  const roots = rc.filter((c) => !c.in_reply_to_id);
  const threads: ReviewThreadView[] = roots.map((c) => ({
    id: c.id, path: c.path, line: c.line ?? c.original_line, outdated: c.line == null, resolved: resolved[String(c.id)]?.resolved === true, threadId: resolved[String(c.id)]?.threadId,
    code: tailOfHunk(c.diff_hunk, 6).map((l) => ({ a: l.oldNo, b: l.newNo, type: l.type, text: l.text })),
    messages: [msg(c), ...rc.filter((x) => x.in_reply_to_id === c.id).map(msg)],
  }));
  const mine = reviews.filter((r) => r.user.login === me && r.state !== 'PENDING').pop();
  const summary = toSummary(ref.owner, ref.repo, p);
  let hygiene: HygieneCheck[] = [];
  try {
    hygiene = await prHygiene(ref, summary);
  } catch (e) {
    console.error('[prsight] title/description checks skipped:', (e as Error).message);
  }
  return { pr: { ...summary, id: prId(ref) }, threads, conversation: ic.map(msg), viewer: me, myReview: mine ? { state: mine.state, at: mine.submitted_at } : null, hygiene };
}

export async function reply(ref: PrRef, commentId: number, body: string): Promise<void> {
  await ghSend('POST', `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments/${commentId}/replies`, { body });
}
export async function comment(ref: PrRef, body: string): Promise<void> {
  await ghSend('POST', `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`, { body });
}
export async function review(ref: PrRef, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body: string, comments: LineComment[] = [], commitId?: string): Promise<string> {
  // Line comments go in the same reviews call GitHub's "Start a review" uses (one write endpoint, already allowed).
  const lines = comments.map((c) => ({
    path: c.path, body: c.body, line: c.line, side: c.side,
    ...(c.startLine && c.startLine !== c.line ? { start_line: c.startLine, start_side: c.startSide ?? c.side } : {}),
  }));
  const r = await ghSend<{ state: string }>('POST', `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`, {
    event, body: body || undefined, ...(commitId ? { commit_id: commitId } : {}), ...(lines.length ? { comments: lines } : {}),
  });
  return r.state;
}

/** Every changed file with its diff, and the head commit the line numbers refer to. */
export async function prFiles(ref: PrRef): Promise<PrFilesView> {
  const base = `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const [p, files] = await Promise.all([
    ghGet<{ head: { sha: string } }>(base, { cache: false }),
    ghPaged<{ filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string }>(`${base}/files`, 3000),
  ]);
  return { headSha: p.head.sha, files: files.map((f) => ({ path: f.filename, previous: f.previous_filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })) };
}

// ---------------- Snapshot for analysis ----------------

const PARSE_EXT = /\.(tf|hcl|tfvars|ya?ml|json|py|sh|bash|xml|md|mdx)$/i;

export async function snapshot(ref: PrRef, onStep?: (label: string) => void, sinceSha?: string | null): Promise<PrSnapshot> {
  const base = `/repos/${ref.owner}/${ref.repo}`;
  onStep?.(`Fetching ${ref.repo} #${ref.number}`);
  const p = await ghGet<RestPull>(`${base}/pulls/${ref.number}`);
  const summary = toSummary(ref.owner, ref.repo, p);
  const [files, rc, ic, commits, resolved] = await Promise.all([
    ghPaged<{ filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string; previous_filename?: string }>(`${base}/pulls/${ref.number}/files`, 300),
    ghPaged<RestReviewComment>(`${base}/pulls/${ref.number}/comments`),
    ghPaged<RestIssueComment>(`${base}/issues/${ref.number}/comments`),
    ghPaged<{ sha: string; commit: { message: string } }>(`${base}/pulls/${ref.number}/commits`, 250),
    resolvedMap(ref),
  ]);
  const contents: Record<string, string> = {};
  const parseable = files.filter((f) => f.status !== 'removed' && PARSE_EXT.test(f.filename) && f.changes < 5000).slice(0, 80);
  await Promise.all(
    parseable.map(async (f) => {
      try {
        const c = await ghGet<string>(`${base}/contents/${encodePath(f.filename)}?ref=${summary.headSha}`, { raw: true });
        if (c.length < 400_000) contents[f.filename] = c;
      } catch {
        /* binary, too large or not accessible: the patch is still used */
      }
    }),
  );
  // Team rule files at the base branch: root files plus AGENTS.md / CLAUDE.md in touched folders.
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.filename.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const ruleCandidates = [...RULE_FILE_NAMES, ...[...dirs].slice(0, 30).flatMap((d) => [`${d}/AGENTS.md`, `${d}/CLAUDE.md`])];
  const ruleFiles: Record<string, string> = {};
  await Promise.all(
    ruleCandidates.map(async (path) => {
      try {
        ruleFiles[path] = await ghGet<string>(`${base}/contents/${encodePath(path)}?ref=${encodeURIComponent(summary.base)}`, { raw: true });
      } catch {
        /* not present */
      }
    }),
  );
  // History for the risk overlay (last 20 commits per changed, non-test file on the base branch).
  onStep?.(`Reading file history for ${ref.repo}`);
  const history: PrSnapshot['history'] = {};
  await Promise.all(
    files.filter((f) => !isTestPath(f.filename) && f.status !== 'added').slice(0, 25).map(async (f) => {
      try {
        const cs = await ghGet<Array<{ commit: { message: string } }>>(`${base}/commits?sha=${encodeURIComponent(summary.base)}&path=${encodeURIComponent(f.filename)}&per_page=20`);
        history![f.filename] = { commits: cs.length, fixes: cs.filter((c) => /\b(fix|bug|hotfix|revert)\b/i.test(c.commit.message.split('\n')[0])).length, sample: 20 };
      } catch {
        /* no history */
      }
    }),
  );
  let changedSinceLastReview: string[] | null = null;
  if (sinceSha && sinceSha !== summary.headSha) {
    try {
      const cmp = await ghGet<{ files?: Array<{ filename: string }> }>(`${base}/compare/${sinceSha}...${summary.headSha}`);
      changedSinceLastReview = (cmp.files ?? []).map((f) => f.filename);
    } catch {
      changedSinceLastReview = null;
    }
  } else if (sinceSha) changedSinceLastReview = [];
  return {
    pr: summary,
    files: files.map((f) => ({ path: f.filename, status: f.status as never, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null, previousPath: f.previous_filename ?? null })),
    contents,
    reviewComments: rc.map((c) => ({ id: c.id, inReplyTo: c.in_reply_to_id ?? null, path: c.path, line: c.line, originalLine: c.original_line, diffHunk: c.diff_hunk, author: c.user.login, isBot: isBot(c.user), body: c.body, createdAt: c.created_at })),
    issueComments: ic.map((c) => ({ id: c.id, author: c.user.login, isBot: isBot(c.user), body: c.body, createdAt: c.created_at })),
    commits: commits.map((c) => ({ sha: c.sha, message: c.commit.message })),
    ruleFiles,
    resolvedThreads: resolved,
    history,
    changedSinceLastReview,
  };
}

export async function filePatches(ref: PrRef, paths: string[]): Promise<Record<string, { patch: string | null; status: string }>> {
  const files = await ghPaged<{ filename: string; status: string; patch?: string }>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`, 300);
  const out: Record<string, { patch: string | null; status: string }> = {};
  for (const f of files) if (paths.includes(f.filename)) out[f.filename] = { patch: f.patch ?? null, status: f.status };
  return out;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

const REPOS_QUERY = `query($org: String!, $after: String) {
  repositoryOwner(login: $org) {
    repositories(first: 100, after: $after, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes { name isArchived }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const REPOS_TTL = 12 * 3_600_000;
let repoLoad: Promise<string[]> | null = null;

/** Who to list repos for: the organisation in Settings, or your own account when it is blank. */
async function owner(): Promise<string> {
  return getSettings().org.trim() || (await viewer());
}

/** Every non-archived repo name in the organisation (names only), fetched once and kept for 12 hours. */
async function orgRepoNames(force = false): Promise<string[]> {
  const org = await owner();
  const key = `repos:${org}`;
  const c = cacheGet(key);
  let saved: { at: number; names: string[] } | null = null;
  try {
    saved = c ? (JSON.parse(c.body) as { at: number; names: string[] }) : null;
  } catch {
    saved = null;
  }
  const fetchAll = async (): Promise<string[]> => {
    const names: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 60; page++) {
      type Page = { repositoryOwner: { repositories: { nodes: Array<{ name: string; isArchived: boolean }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null };
      const d: Page = await graphql<Page>(REPOS_QUERY, { org, after });
      const r = d.repositoryOwner?.repositories;
      if (!r) break;
      for (const n of r.nodes) if (n && !n.isArchived) names.push(n.name);
      if (!r.pageInfo.hasNextPage) break;
      after = r.pageInfo.endCursor;
    }
    cachePut(key, null, JSON.stringify({ at: Date.now(), names }));
    return names;
  };
  if (force) {
    repoLoad = null;
    return fetchAll();
  }
  if (saved && Date.now() - saved.at < REPOS_TTL) return saved.names;
  repoLoad ??= fetchAll().finally(() => (repoLoad = null));
  // A stale list answers at once while the fresh one loads.
  return saved ? saved.names : repoLoad;
}

/** The saved organisation repo list, if any, and whether it is still fresh. */
function savedRepoNames(org: string): { names: string[]; fresh: boolean } | null {
  const c = cacheGet(`repos:${org}`);
  if (!c) return null;
  try {
    const v = JSON.parse(c.body) as { at: number; names: string[] };
    return { names: v.names, fresh: Date.now() - v.at < REPOS_TTL };
  } catch {
    return null;
  }
}

/** One page of every repo in the organisation (Load More in the sidebar). */
export async function allRepos(offset: number, limit: number): Promise<{ names: string[]; total: number }> {
  const s = getSettings();
  const names = s.repos.length ? s.repos.map((r) => r.split('/').pop()!) : await orgRepoNames();
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return { names: sorted.slice(offset, offset + limit), total: sorted.length };
}

let starred: { at: number; names: string[] } | null = null;
/** Your starred GitHub repos in the organisation (read-only). */
export async function starredRepos(force = false): Promise<string[]> {
  if (!force && starred && Date.now() - starred.at < 30 * 60_000) return starred.names;
  const org = (await owner()).toLowerCase();
  const list = await ghPaged<{ name: string; owner: { login: string }; archived: boolean }>('/user/starred', 500);
  starred = { at: Date.now(), names: list.filter((r) => r.owner.login.toLowerCase() === org && !r.archived).map((r) => r.name).sort((a, b) => a.localeCompare(b)) };
  return starred.names;
}

/** Repository names containing `q` anywhere (not just whole words): names that start with it first. */
export async function searchRepos(q: string): Promise<string[]> {
  const s = getSettings();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  let names: string[];
  const own = await owner();
  const saved = savedRepoNames(own);
  if (s.repos.length) names = s.repos.map((r) => r.split('/').pop()!);
  else if (saved?.fresh) names = saved.names;
  else {
    // Load the full list in the background; answer now from GitHub search (whole words) plus any older list.
    void orgRepoNames().catch((e) => console.error('[prsight] could not list organisation repos:', (e as Error).message));
    const clean = q.replace(/[^\w.-]/g, ' ').trim();
    const res = await ghGet<{ items: Array<{ name: string }> }>(`/search/repositories?q=${encodeURIComponent(`${clean} in:name ${s.org.trim() ? 'org' : 'user'}:${own} archived:false`)}&per_page=50`, { cache: false }).catch(() => ({ items: [] }));
    names = [...new Set([...res.items.map((r) => r.name), ...(saved?.names ?? []), ...(starred?.names ?? [])])];
  }
  const words = needle.split(/\s+/);
  const hits = names.filter((n) => words.every((w) => n.toLowerCase().includes(w)));
  const rank = (n: string) => (n.toLowerCase().startsWith(needle) ? 0 : n.toLowerCase().split(/[-_.]/).some((p) => p.startsWith(words[0])) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)).slice(0, 40);
}

/** Reload the organisation's repo names now (the Refresh button). */
export async function refreshRepos(): Promise<number> {
  void starredRepos(true).catch(() => undefined);
  if (getSettings().repos.length) return getSettings().repos.length;
  return (await orgRepoNames(true)).length;
}

// ---------------- Title and description checks ----------------

const TEMPLATE_PATHS = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE/pull_request_template.md'];
type RepoCtx = { at: number; template: { path: string; text: string } | null; rules: Array<{ path: string; text: string }>; recentTitles: string[] };
const repoCtx = new Map<string, RepoCtx>();

/** The repo's PR template, team rule files and recent merged PR titles (kept for 30 minutes). */
async function repoContext(owner: string, repo: string, baseRef: string): Promise<RepoCtx> {
  const key = `${owner}/${repo}@${baseRef}`;
  const hit = repoCtx.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit;
  const base = `/repos/${owner}/${repo}`;
  const raw = (path: string) => ghGet<string>(`${base}/contents/${encodePath(path)}?ref=${encodeURIComponent(baseRef)}`, { raw: true }).catch(() => null);
  let template: RepoCtx['template'] = null;
  for (const path of TEMPLATE_PATHS) {
    const text = await raw(path);
    if (text) {
      template = { path, text };
      break;
    }
  }
  const rules = (await Promise.all(RULE_FILE_NAMES.map(async (path) => ({ path, text: await raw(path) })))).filter((r): r is { path: string; text: string } => !!r.text);
  const recentTitles = await ghGet<Array<{ title: string; merged_at: string | null }>>(`${base}/pulls?state=closed&per_page=30&sort=updated&direction=desc`)
    .then((l) => l.filter((x) => x.merged_at).map((x) => x.title))
    .catch(() => []);
  const ctx = { at: Date.now(), template, rules, recentTitles };
  repoCtx.set(key, ctx);
  return ctx;
}

const EDIT_QUERY = `query($o: String!, $r: String!, $n: Int!) {
  repository(owner: $o, name: $r) { pullRequest(number: $n) { lastEditedAt createdAt commits(last: 100) { nodes { commit { committedDate messageHeadline } } } } }
}`;

async function prHygiene(ref: PrRef, pr: PrSummary): Promise<HygieneCheck[]> {
  type E = { repository: { pullRequest: { lastEditedAt: string | null; createdAt: string; commits: { nodes: Array<{ commit: { committedDate: string; messageHeadline: string } }> } } | null } | null };
  const [ctx, ed] = await Promise.all([repoContext(ref.owner, ref.repo, pr.base), graphql<E>(EDIT_QUERY, { o: ref.owner, r: ref.repo, n: ref.number })]);
  const p = ed.repository?.pullRequest;
  const inTitle = findTicketKeys(pr.title, 'title', DEFAULT_DETECT).length > 0;
  const anywhere = inTitle || findTicketKeys(pr.branch, 'branch', DEFAULT_DETECT).length > 0 || findTicketKeys(pr.body ?? '', 'description', DEFAULT_DETECT).length > 0;
  return checkPrHygiene({
    title: pr.title, body: pr.body ?? '', branch: pr.branch, draft: pr.draft,
    template: ctx.template, rules: ctx.rules, recentTitles: ctx.recentTitles.filter((t) => t !== pr.title),
    lastEditedAt: p?.lastEditedAt ?? null, createdAt: p?.createdAt ?? pr.updatedAt,
    commits: (p?.commits.nodes ?? []).map((c) => ({ date: c.commit.committedDate, message: c.commit.messageHeadline })),
    ticketInTitle: inTitle, ticketAnywhere: anywhere,
  });
}

// ---------------- Live PR status (state, reviews, checks, conflicts) ----------------

type StatusNode = {
  state: 'OPEN' | 'CLOSED' | 'MERGED'; isDraft: boolean; mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  latestOpinionatedReviews: { nodes: Array<{ state: string } | null> };
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' } | null } }> };
};

/** One GraphQL request for every PR in the report (read-only). */
export async function prStatuses(refs: PrRef[]): Promise<Record<string, PrStatus>> {
  const fields = 'state isDraft mergeable reviewDecision latestOpinionatedReviews(first: 20) { nodes { state } } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }';
  const vars: Record<string, unknown> = {};
  const decl: string[] = [];
  const body = refs.map((r, i) => {
    vars[`o${i}`] = r.owner;
    vars[`r${i}`] = r.repo;
    vars[`n${i}`] = r.number;
    decl.push(`$o${i}: String!, $r${i}: String!, $n${i}: Int!`);
    return `p${i}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { ${fields} } }`;
  });
  const d = await graphql<Record<string, { pullRequest: StatusNode | null } | null>>(`query(${decl.join(', ')}) { ${body.join(' ')} }`, vars);
  const out: Record<string, PrStatus> = {};
  refs.forEach((r, i) => {
    const p = d[`p${i}`]?.pullRequest;
    if (!p) return;
    const roll = p.commits.nodes[0]?.commit.statusCheckRollup?.state;
    out[prId(r)] = {
      state: p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open',
      review: p.reviewDecision === 'APPROVED' ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : p.reviewDecision === 'REVIEW_REQUIRED' ? 'required' : 'none',
      approvals: p.latestOpinionatedReviews.nodes.filter((x) => x?.state === 'APPROVED').length,
      checks: !roll ? 'none' : roll === 'SUCCESS' ? 'passing' : roll === 'FAILURE' || roll === 'ERROR' ? 'failing' : 'running',
      conflicts: p.state === 'OPEN' && p.mergeable === 'CONFLICTING',
    };
  });
  return out;
}

// ---------------- Profile pictures ----------------

const AVATAR_TTL = 7 * 86_400_000;
const avatarLoads = new Map<string, Promise<string>>();

/** Profile pictures as data URIs (the window never goes online). Kept on this computer for a week; '' when none. */
export async function avatars(logins: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(logins)].map(async (login) => {
      const name = login.replace(/\[bot\]$/i, '');
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(name)) return void (out[login] = '');
      const key = `avatar:${name.toLowerCase()}`;
      const c = cacheGet(key);
      if (c) {
        try {
          const v = JSON.parse(c.body) as { at: number; url: string };
          if (Date.now() - v.at < AVATAR_TTL) return void (out[login] = v.url);
        } catch {
          /* refetch */
        }
      }
      let job = avatarLoads.get(key);
      if (!job) {
        job = (async () => {
          let url = '';
          try {
            // github.com/<login>.png redirects to avatars.githubusercontent.com; both hosts are allowed.
            const res = await safeFetch(`https://github.com/${encodeURIComponent(name)}.png?size=64`);
            const type = res.headers.get('content-type') ?? '';
            if (res.ok && /^image\/(png|jpeg|gif|webp)/.test(type)) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length < 300_000) url = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
            }
          } catch {
            /* no picture: the initial is shown */
          }
          cachePut(key, null, JSON.stringify({ at: Date.now(), url }));
          return url;
        })().finally(() => avatarLoads.delete(key));
        avatarLoads.set(key, job);
      }
      out[login] = await job;
    }),
  );
  return out;
}
