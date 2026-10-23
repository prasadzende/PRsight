// Domain model shared by main, worker and renderer. Plain data only (structured-clone safe).

export type PrState = 'open' | 'closed' | 'merged';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PrSummary extends PrRef {
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
  headSha: string;
  requestedReviewers: string[];
  requestedTeams: string[];
}

export interface PrFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  patch?: string | null;
  previousPath?: string | null;
}

export interface ReviewComment {
  id: number;
  inReplyTo?: number | null;
  path: string;
  line?: number | null;
  originalLine?: number | null;
  diffHunk: string;
  author: string;
  isBot: boolean;
  body: string;
  createdAt: string;
}

export interface IssueComment {
  id: number;
  author: string;
  isBot: boolean;
  body: string;
  createdAt: string;
}

export interface Commit {
  sha: string;
  message: string;
}

/** Everything the analysis needs about one PR, fetched once and cached. */
export interface PrSnapshot {
  pr: PrSummary;
  files: PrFile[];
  /** Head contents of parseable changed files, keyed by path. */
  contents: Record<string, string>;
  reviewComments: ReviewComment[];
  issueComments: IssueComment[];
  commits: Commit[];
  /** Team rule files at the base branch: AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, per-folder copies. */
  ruleFiles: Record<string, string>;
  /** Optional: resolution state per root review comment id (from GraphQL reviewThreads). */
  resolvedThreads?: Record<string, boolean>;
  /** Optional: per-path history from the commits API, for the risk overlay. */
  history?: Record<string, { commits: number; fixes: number; sample: number }>;
  /** Optional: paths changed since the reviewer's last review of this PR. */
  changedSinceLastReview?: string[] | null;
}

export interface Ticket {
  id: string;
  system: 'ado' | 'jira';
  key: string;
  title?: string;
  state?: string;
  url?: string;
  criteria?: string[];
  foundIn: Array<'title' | 'branch' | 'description' | 'commits' | 'manual' | 'board'>;
  prIds: string[];
}

export interface Evidence {
  prId: string;
  path: string;
  line?: number;
  snippet: string;
}

export type FileType =
  | 'tf' | 'ado' | 'gha' | 'apim' | 'schema' | 'py' | 'sh' | 'nb' | 'yaml' | 'json' | 'just' | 'md' | 'other';

export type ChangeKind = 'Config' | 'Logic' | 'Test' | 'Docs' | 'Pipeline' | 'Script';

export interface FileNode {
  id: string;
  prId: string;
  /** Plain-language name shown first. */
  name: string;
  /** Path, or a pattern such as team/alpha/{dev,nonprod,prod}/config.yaml for grouped files. */
  path: string;
  paths: string[];
  sub: string;
  fileTypes: FileType[];
  kind: ChangeKind;
  isTest: boolean;
  additions: number;
  deletions: number;
  /** Shown by default in the Files view (cross-PR or High finding). */
  key: boolean;
}

export type LinkKind = 'connects' | 'matches' | 'differs' | 'docs';
export type Tone = 'bad' | 'check' | 'n';
export type Impact = 'Interface' | 'Behaviour' | 'Operational' | 'Docs only';

export interface Link {
  id: string;
  n: number;
  kind: LinkKind;
  tone: Tone;
  impact: Impact;
  impactWhy: string;
  title: string;
  text: string;
  /** Short label for the arrow in the Files view. */
  label: string;
  nodes: string[];
  prIds: string[];
  evidence: Evidence[];
  shared: string[];
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: 'int' | LinkKind;
  linkId?: string;
}

export type Severity = 'High' | 'Medium' | 'Info';

export interface Finding {
  id: string;
  sev: Severity;
  src: string;
  /** True for findings from AI reviewers such as Copilot (first pass, never the independent check). */
  aiReviewer: boolean;
  /** True when written by this app's optional AI. */
  ai?: boolean;
  where: string;
  text: string;
  nodeId?: string;
  prId: string;
  status: 'Open' | 'Fixed' | 'Outdated';
  evidence?: Evidence;
}

export interface Verified {
  id: string;
  src: 'Team rule' | 'Rule' | 'Review';
  where: string;
  text: string;
  nodeId?: string;
}

export interface TeamRuleCheck {
  id: string;
  prId: string;
  ruleFile: string;
  rule: string;
  passed: boolean;
  where: string;
  text: string;
  nodeId?: string;
}

export interface PrCard {
  prId: string;
  role: string;
  head: string;
  text: string;
  files: number;
  fit: { label: string; tone: 'ok' | 'check' | 'n'; why: string };
  hygiene: { description: boolean; ticketIn: string[] };
}

export interface StoryBox {
  prId: string;
  step: number;
  role: string;
  head: string;
  text: string;
  row: 0 | 1;
}

export interface StoryArrow {
  id: string;
  from: string;
  to: string;
  label: string;
  sub: string;
  tone: Tone;
  flag: string;
  linkId: string;
}

export interface TourStep {
  boxes: string[];
  arrows: string[];
  text: string;
}

export interface MergeStep {
  n: number;
  what: string;
  why: string;
  tone: Tone;
  prIds: string[];
}

export interface CheckItem {
  id: string;
  label: string;
  nodeId?: string;
  human: boolean;
}

export interface NodeOverlay {
  tests: string;
  noTest: boolean;
  kind: ChangeKind;
  since: boolean | null;
  risk: { level: 'High' | 'Medium' | 'Low' | 'Unknown'; why: string };
  fit: string | null;
}

export interface Report {
  id: string;
  createdAt: string;
  title: string;
  prs: PrSummary[];
  prIds: string[];
  tickets: Ticket[];
  nodes: FileNode[];
  edges: Edge[];
  links: Link[];
  findings: Finding[];
  verified: Verified[];
  teamRules: TeamRuleCheck[];
  ruleFiles: Array<{ prId: string; repo: string; path: string; checked: number }>;
  cards: PrCard[];
  story: { boxes: StoryBox[]; arrows: StoryArrow[] };
  tour: TourStep[];
  order: MergeStep[];
  checklist: CheckItem[];
  overlays: Record<string, NodeOverlay>;
  summary: { tldr: string; text: string; watch: Array<{ sev: string; head: string; text: string }> };
  totals: { files: number; links: number; high: number; medium: number; info: number };
  ai?: AiNotes;
  /** Why the optional AI explanation was skipped, if it was. */
  aiError?: string;
  /** Why a ticket's details could not be loaded from the board, by ticket id. */
  ticketErrors?: Record<string, string>;
  /** Notes from past reviews of the same repos (kept on this computer). */
  memory?: Array<{ repo: string; when: string; text: string; ok: boolean }>;
}

export interface AiNotes {
  provider: string;
  tldr?: string;
  summary?: string;
  ask?: string;
  prs?: Record<string, { head: string; text: string }>;
  links?: Record<string, string>;
  findings?: Array<{ sev: Severity; where: string; text: string; path: string; line?: number }>;
  checklistOrder?: string[];
}

export const prId = (r: PrRef): string => `${r.owner}/${r.repo}#${r.number}`;
