// Findings from bot review comments (Copilot, Wiz and others) and from rules on the diff.
import type { Finding, Link, PrSnapshot, Severity } from '../shared/model';
import { prId } from '../shared/model';
import { changeKindOf, isTestPath, fileTypeOf } from './classify';
import { findValueChanges, parsePatch } from './diff';
import { ticketSources } from './tickets';

/** AI reviewers: their findings are a first pass and never count as the independent check. */
export const AI_REVIEWERS = [/^copilot/i, /copilot-pull-request-reviewer/i, /^coderabbit/i, /^greptile/i, /claude/i, /^sourcery/i, /^codium/i];
export const isAiReviewer = (author: string): boolean => AI_REVIEWERS.some((r) => r.test(author));
const SCANNERS = [/^wiz/i, /snyk/i, /sonar/i, /dependabot/i, /checkov/i, /trivy/i];
export const scannerName = (author: string): string | null => {
  const m = SCANNERS.find((r) => r.test(author));
  if (!m) return null;
  const a = author.toLowerCase();
  return a.startsWith('wiz') ? 'Wiz' : a.includes('snyk') ? 'Snyk' : a.includes('sonar') ? 'Sonar' : a.includes('dependabot') ? 'Dependabot' : a.includes('checkov') ? 'Checkov' : 'Trivy';
};

const BLOCKING_WORDS = /\b(cannot be (deleted|removed|created|updated|used)|can't be (deleted|removed|created)|will fail|would fail|fails (with|on)|fail on first|deployment (will|would) fail|data loss|breaks (the|every|all)|security (issue|risk|vulnerability)|leaks? (the |a )?(secret|key|token))\b/i;

const firstSentence = (body: string): string => {
  const clean = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(clean);
  return (m ? m[1] : clean.slice(0, 200)).trim();
};

const sevFromScanner = (body: string): Severity => (/\b(critical|high)\b/i.test(body) ? 'High' : /\bmedium\b/i.test(body) ? 'Medium' : 'Info');

export function reviewFindings(s: PrSnapshot, nodeOf: (pr: string, path: string) => string, repoLabel: string): Finding[] {
  const id = prId(s.pr);
  const out: Finding[] = [];
  const roots = s.reviewComments.filter((c) => !c.inReplyTo);
  for (const c of roots) {
    const ai = isAiReviewer(c.author);
    const scan = scannerName(c.author);
    if (!ai && !scan) continue;
    const resolved = s.resolvedThreads?.[String(c.id)] === true;
    const outdated = c.line == null;
    const text = firstSentence(c.body);
    if (!text) continue;
    const sev: Severity = scan ? sevFromScanner(c.body) : BLOCKING_WORDS.test(c.body) ? 'High' : 'Medium';
    out.push({
      id: `F-${id}-rc${c.id}`, sev, src: scan ?? displayBot(c.author), aiReviewer: ai, where: `${repoLabel} · ${c.path}${c.line ?? c.originalLine ? `:${c.line ?? c.originalLine}` : ''}`,
      text, nodeId: nodeOf(id, c.path), prId: id, status: resolved ? 'Fixed' : outdated ? 'Outdated' : 'Open',
      evidence: { prId: id, path: c.path, line: c.line ?? c.originalLine ?? undefined, snippet: c.diffHunk.split('\n').pop()?.slice(1).trim() ?? '' },
    });
  }
  // Scanner summaries posted as PR comments (e.g. "105 IaC findings")
  for (const c of s.issueComments) {
    const scan = scannerName(c.author);
    if (!scan) continue;
    const count = /(\d+)\s+(?:IaC |)(?:findings|issues|vulnerabilities)/i.exec(c.body.replace(/<[^>]+>/g, ' '));
    if (!count) continue;
    out.push({ id: `F-${id}-ic${c.id}`, sev: 'Info', src: scan, aiReviewer: false, where: `${repoLabel} #${s.pr.number}`, text: `${count[1]} ${scan} findings reported on this PR`, prId: id, status: 'Open' });
  }
  return out;
}

const displayBot = (a: string): string => (/copilot/i.test(a) ? 'Copilot' : a.replace(/\[bot]$/, ''));

export function ruleFindings(snaps: PrSnapshot[], links: Link[], nodeOf: (pr: string, path: string) => string, labels: Record<string, string>): Finding[] {
  const out: Finding[] = [];
  // Rename coupling is Blocking: one PR alone breaks the other side.
  for (const l of links.filter((x) => x.tone === 'bad')) {
    out.push({ id: `F-rule-${l.id}`, sev: 'High', src: 'Rule', aiReviewer: false, where: l.prIds.map((p) => labels[p]).join(' + '), text: `${l.text.split('. ')[0]}: ship together or the reader breaks`, nodeId: l.nodes[0], prId: l.prIds[0], status: 'Open' });
  }
  for (const s of snaps) {
    const id = prId(s.pr);
    const label = labels[id];
    // Large operational value changes (limits, quotas, timeouts)
    for (const f of s.files) {
      if (isTestPath(f.path)) continue;
      for (const v of findValueChanges(parsePatch(f.patch))) {
        const ratio = Math.max(v.from, v.to) / Math.max(1, Math.min(v.from, v.to));
        if (ratio < 10) continue;
        out.push({ id: `F-${id}-val-${f.path}-${v.line}`, sev: 'Info', src: 'Rule', aiReviewer: false, where: `${label} · ${f.path}:${v.line}`,
          text: `Operational impact: ${v.key} ${v.to < v.from ? 'cut' : 'raised'} from ${fmt(v.from)} to ${fmt(v.to)} (${Math.round(ratio)}×)`, nodeId: nodeOf(id, f.path), prId: id, status: 'Open',
          evidence: { prId: id, path: f.path, line: v.line, snippet: v.snippet } });
      }
    }
    // Logic changed in a module or root with no test change anywhere under it
    const tests = s.files.filter((f) => isTestPath(f.path)).map((f) => f.path);
    const logic = s.files.filter((f) => changeKindOf(f.path) === 'Logic' && f.status !== 'removed' && fileTypeOf(f.path) === 'tf');
    for (const f of logic) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      const covered = tests.some((t) => t.startsWith(dir + '/') || (s.contents[t] ?? '').includes(dir.split('/').pop() ?? '\u0000'));
      if (!covered) out.push({ id: `F-${id}-notest-${f.path}`, sev: 'Medium', src: 'Rule', aiReviewer: false, where: `${label} · ${f.path}`, text: 'Logic changed with no test changed for it', nodeId: nodeOf(id, f.path), prId: id, status: 'Open' });
    }
    // Title says [main] but the PR targets another branch
    const tb = /^\[([\w./-]+)]/.exec(s.pr.title);
    if (tb && tb[1] !== s.pr.base) out.push({ id: `F-${id}-base`, sev: 'Info', src: 'Rule', aiReviewer: false, where: label, text: `Title says [${tb[1]}] but the PR targets ${s.pr.base}`, prId: id, status: 'Open' });
    // Hygiene
    if (!s.pr.body.trim()) out.push({ id: `F-${id}-nodesc`, sev: 'Medium', src: 'Rule', aiReviewer: false, where: label, text: 'The PR has no description', prId: id, status: 'Open' });
    const src = ticketSources(s);
    if (src.length === 0) out.push({ id: `F-${id}-noticket`, sev: 'Info', src: 'Rule', aiReviewer: false, where: label, text: 'No ticket number in the title, branch, description or commits', prId: id, status: 'Open' });
    else if (src.length === 1 && src[0] === 'title') out.push({ id: `F-${id}-tktitle`, sev: 'Info', src: 'Rule', aiReviewer: false, where: label, text: 'Ticket number found only in the title, not the branch', prId: id, status: 'Open' });
  }
  return out;
}

const fmt = (n: number): string => n.toLocaleString('en-GB');
