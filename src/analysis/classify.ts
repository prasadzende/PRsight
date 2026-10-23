// Rule-based file classification: file type, change kind, tests, grouping and plain names.
import type { ChangeKind, FileType } from '../shared/model';

export interface FileTypeRule {
  id: FileType;
  label: string;
  test: (path: string) => boolean;
}

/** First match wins. New types are added here as rules, not code changes elsewhere. */
export const FILE_TYPES: FileTypeRule[] = [
  { id: 'tf', label: 'Terraform', test: (p) => /\.tf$|\.tftest\.hcl$|\.tfvars$|\.hcl$/.test(p) },
  { id: 'ado', label: 'Azure DevOps pipeline', test: (p) => /^\.azdo\/|(^|\/)\.azdo\/|azure-pipelines[^/]*\.ya?ml$/.test(p) },
  { id: 'gha', label: 'GitHub Actions', test: (p) => /^\.github\/workflows\//.test(p) },
  { id: 'apim', label: 'APIM policy (XML)', test: (p) => /policies\/[^/]+\.xml$/.test(p) },
  { id: 'schema', label: 'JSON Schema', test: (p) => /\.schema\.json$/.test(p) },
  { id: 'py', label: 'Python', test: (p) => /\.py$/.test(p) },
  { id: 'sh', label: 'Shell (Bash)', test: (p) => /\.(sh|bash)$/.test(p) },
  { id: 'nb', label: 'Notebook', test: (p) => /\.ipynb$/.test(p) },
  { id: 'yaml', label: 'YAML config', test: (p) => /\.ya?ml$/.test(p) },
  { id: 'json', label: 'JSON', test: (p) => /\.json$/.test(p) },
  { id: 'just', label: 'justfile', test: (p) => /(^|\/)justfile$/i.test(p) },
  { id: 'md', label: 'Markdown docs', test: (p) => /\.mdx?$/.test(p) },
  { id: 'other', label: 'Other', test: () => true },
];

export const fileTypeOf = (path: string): FileType => (FILE_TYPES.find((t) => t.test(path)) ?? FILE_TYPES[FILE_TYPES.length - 1]).id;
export const fileTypeLabel = (t: FileType): string => FILE_TYPES.find((x) => x.id === t)?.label ?? 'Other';

export function isTestPath(p: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|fixtures)(\/|$)|\.tftest\.hcl$|(^|\/)test_[^/]+\.py$|_test\.(py|go|ts)$|\.(spec|test)\.[jt]sx?$/.test(p);
}

export function changeKindOf(p: string): ChangeKind {
  if (isTestPath(p)) return 'Test';
  const t = fileTypeOf(p);
  if (t === 'md') return 'Docs';
  if (t === 'ado' || t === 'gha' || t === 'just' || (/^\.github\//.test(p)) || /(^|\/)\.gitignore$/.test(p)) return 'Pipeline';
  if (t === 'sh' || t === 'nb' || /^scripts?\//.test(p)) return 'Script';
  if (t === 'yaml' || t === 'json' || t === 'schema' || /\.tfvars$/.test(p)) return 'Config';
  return 'Logic';
}

const ENV_SEG = /^(dev|development|test|nonprod|non-prod|preprod|staging|stage|uat|prod|production|sandbox)$/i;

/**
 * Group key for files that belong in one box:
 * - the same file across environment folders (team/alpha/{dev,nonprod,prod}/config.yaml)
 * - all tests of one PR, all docs of one PR, all scripts of one folder
 */
export function groupKey(p: string): string {
  const kind = changeKindOf(p);
  if (kind === 'Test') return 'tests';
  if (kind === 'Docs') return 'docs';
  if (kind === 'Script') return 'scripts:' + dirOf(p);
  const segs = p.split('/');
  const envIdx = segs.findIndex((s) => ENV_SEG.test(s));
  if (envIdx >= 0 && envIdx < segs.length - 1) {
    const copy = segs.slice();
    copy[envIdx] = '*';
    return 'env:' + copy.join('/');
  }
  // config/hub/dev.yaml + nonprod.yaml + prod.yaml (+ schema) -> one config box
  const base = segs[segs.length - 1];
  const stem = base.replace(/\.(ya?ml|json)$/, '');
  if (ENV_SEG.test(stem) || /\.schema\.json$/.test(base) && segs.length > 1) return 'cfgdir:' + dirOf(p);
  // policies folder -> one box per policy file; terraform main/variables in one module -> one box
  if (/\.tf$/.test(p) && /(^|\/)(main|variables|outputs|locals|versions|providers)\.tf$/.test(p)) return 'tfmod:' + dirOf(p) + ':' + tfPart(base);
  return 'file:' + p;
}

function tfPart(base: string): string {
  // variables.tf stays apart from main.tf so "inputs" and "resources" can be told apart
  return base === 'variables.tf' ? 'inputs' : base === 'outputs.tf' ? 'outputs' : 'body';
}

export const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Collapse paths into a readable pattern: a/{dev,prod}/b.yaml or "tests/ (7 files)". */
export function pathPattern(paths: string[]): string {
  if (paths.length === 1) return paths[0];
  const split = paths.map((p) => p.split('/'));
  const len = split[0].length;
  if (split.every((s) => s.length === len)) {
    const diffIdx: number[] = [];
    for (let i = 0; i < len; i++) if (new Set(split.map((s) => s[i])).size > 1) diffIdx.push(i);
    if (diffIdx.length === 1) {
      const i = diffIdx[0];
      const vals = [...new Set(split.map((s) => s[i]))];
      const copy = split[0].slice();
      copy[i] = '{' + vals.join(',') + '}';
      return copy.join('/');
    }
  }
  const common = commonDir(paths);
  return common ? `${common}/ (${paths.length} files)` : `${paths.length} files`;
}

export function commonDir(paths: string[]): string {
  const parts = paths.map((p) => dirOf(p).split('/'));
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const v = parts[0][i];
    if (v === undefined || !parts.every((p) => p[i] === v)) break;
    out.push(v);
  }
  return out.filter(Boolean).join('/');
}

const humanize = (s: string): string =>
  s.replace(/\.(tf|tftest\.hcl|ya?ml|json|xml|py|sh|md|ipynb)$/i, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

/** A short plain name for a box, built from its role and folder. */
export function plainName(key: string, paths: string[], mdTitle?: string): string {
  const first = paths[0];
  const kind = changeKindOf(first);
  if (key === 'tests') return paths.length === 1 ? `Test: ${humanize(baseOf(first))}` : 'Tests';
  if (key === 'docs') {
    if (paths.length > 1) return 'Docs';
    if (/(^|\/)copilot-instructions\.md$/.test(first)) return 'Copilot instructions';
    if (/(^|\/)(AGENTS|CLAUDE)\.md$/.test(first)) return `${baseOf(first).replace('.md', '')} rules`;
    if (mdTitle && /^docs\//.test(first)) return mdTitle.split(/\s+[—–-]\s+/)[0].slice(0, 48);
    return humanize(baseOf(first));
  }
  if (key.startsWith('scripts:')) return paths.length === 1 ? `Script: ${humanize(baseOf(first))}` : 'Scripts';
  if (key.startsWith('env:')) {
    const segs = first.split('/');
    const owner = segs.filter((s) => !ENV_SEG.test(s)).slice(-2, -1)[0] ?? '';
    return `${humanize(owner) || 'Environment'} ${humanize(baseOf(first))} (${paths.length} envs)`.replace(/ config config/, ' config');
  }
  if (key.startsWith('cfgdir:')) return `${humanize(baseOf(dirOf(first))) || 'Config'} settings`;
  if (key.startsWith('tfmod:')) {
    const mod = baseOf(dirOf(first)) || 'root';
    const part = key.split(':').pop();
    const label = part === 'inputs' ? 'inputs' : part === 'outputs' ? 'outputs' : 'resources';
    return `${humanize(mod)} ${label}`;
  }
  const b = baseOf(first);
  if (/\.schema\.json$/.test(b)) return `${humanize(b.replace(/\.schema\.json$/, ''))} schema`;
  if (/policies\//.test(first)) return `${humanize(b)} policy`;
  if (/\.py$/.test(b)) return humanize(b);
  if (kind === 'Pipeline') return `Pipeline: ${humanize(b)}`;
  return humanize(b) || b;
}

export function firstHeading(md: string | undefined): string | undefined {
  if (!md) return undefined;
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim().slice(0, 60) : undefined;
}
