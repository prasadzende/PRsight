import { describe, expect, it } from 'vitest';
import { Channels } from '../src/shared/ipc';
import { CHANNEL_NAMES } from '../src/shared/channelNames';
import { findRenames, findValueChanges, parsePatch } from '../src/analysis/diff';
import { detectTickets, findTicketKeys, DEFAULT_DETECT } from '../src/analysis/tickets';
import { fileTypeOf, groupKey, pathPattern } from '../src/analysis/classify';
import { redact } from '../src/main/ai/redact';
import { AI_RESPONSE_JSON_SCHEMA, parseAiResponse } from '../src/main/ai/schema';

describe('ipc', () => {
  it('preload channel list matches the declared channels', () => {
    expect([...CHANNEL_NAMES].sort()).toEqual(Object.keys(Channels).sort());
  });
});

describe('diff', () => {
  const patch = '@@ -1,3 +1,3 @@\n tokenQuota:\n-  tpm: 50000\n+  tokensPerMinute: 50000\n-  periodLimit: 2000000\n+  periodLimit: 100000';
  it('finds renames and value changes', () => {
    const h = parsePatch(patch);
    expect(findRenames(h).map((r) => `${r.from}>${r.to}`)).toEqual(['tpm>tokensPerMinute']);
    expect(findValueChanges(h)[0]).toEqual({ key: 'periodLimit', from: 2000000, to: 100000, line: 3, snippet: 'periodLimit: 100000' });
  });
});

describe('tickets', () => {
  it('reads Azure DevOps and Jira keys', () => {
    expect(findTicketKeys('[main] 1241489 - Add things', 'title', DEFAULT_DETECT).map((k) => k.key)).toEqual(['1241489']);
    expect(findTicketKeys('feature/1241489_product_policies', 'branch', DEFAULT_DETECT).map((k) => k.key)).toEqual(['1241489']);
    expect(findTicketKeys('Fixes AB#42 and PLAT-77', 'description', DEFAULT_DETECT).map((k) => k.key)).toEqual(['42', 'PLAT-77']);
    expect(findTicketKeys('Uses SHA-256 and RFC-7231', 'description', DEFAULT_DETECT)).toEqual([]);
  });
  it('accepts manual numbers', () => {
    expect(detectTickets([], DEFAULT_DETECT, ['AB#99', 'OPS-12']).map((t) => t.id)).toEqual(['ado-99', 'jira-OPS-12']);
  });
});

describe('classify', () => {
  it('types files by path rules', () => {
    expect(fileTypeOf('.azdo/templates/terraform-plan.yaml')).toBe('ado');
    expect(fileTypeOf('terraform/gateway/modules/apim/policies/usage-quota.xml')).toBe('apim');
    expect(fileTypeOf('config/gateway/config.schema.json')).toBe('schema');
    expect(fileTypeOf('scripts/quota-smoke-test.sh')).toBe('sh');
  });
  it('groups the same file across environments', () => {
    expect(groupKey('team/alpha/dev/config.yaml')).toBe(groupKey('team/alpha/prod/config.yaml'));
    expect(pathPattern(['team/alpha/dev/config.yaml', 'team/alpha/prod/config.yaml'])).toBe('team/alpha/{dev,prod}/config.yaml');
  });
});

describe('redaction', () => {
  it('removes tokens, keys and IDs before AI calls', () => {
    // Built at runtime so the repo holds nothing that looks like a real token to secret scanners.
    const gh = ['ghp', 'x'.repeat(36)].join('_');
    const key = ['sk', 'ant', 'x'.repeat(24)].join('-');
    const out = redact(`token=${gh} key ${key} id 00000000-0000-4000-8000-000000000000 mail a.b@example.com`);
    expect(/ghp_|sk-ant|00000000-0000|example\.com/.test(out)).toBe(false);
  });
});

describe('AI reply data model', () => {
  it('accepts a well-formed reply', () => {
    const r = parseAiResponse({ tldr: 'One line.', summary: 'Some sentences.', ask: '', prs: [{ id: 'o/r#1', head: 'Adds limits', text: 'Short.' }], links: [{ id: 'L1', text: 'Why.' }], findings: [], checklistOrder: ['C-1'] });
    expect(r.ok).toBe(true);
  });
  it('coerces common drift: records, severity words, long text', () => {
    const r = parseAiResponse({ tldr: 'x'.repeat(900), summary: 'S', prs: { 'o/r#1': { head: 'H', text: 'T' } }, links: { L1: 'Why' }, findings: [{ sev: 'Blocking', path: 'a.tf', line: '12', where: 'a.tf:12', text: 'Bad' }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.tldr.length).toBe(400);
      expect(r.data.prs[0].id).toBe('o/r#1');
      expect(r.data.findings[0]).toEqual({ severity: 'High', path: 'a.tf', line: 12, where: 'a.tf:12', text: 'Bad' });
    }
  });
  it('rejects replies with no summary and reports why', () => {
    const r = parseAiResponse({ prs: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.startsWith('tldr'))).toBe(true);
  });
  it('publishes a JSON Schema for structured output', () => {
    expect((AI_RESPONSE_JSON_SCHEMA as { type: string }).type).toBe('object');
  });
});

describe('Prompt config', () => {
  it('fills every placeholder each prompt uses, and only those', async () => {
    const { PROMPTS, fill, placeholders } = await import('../src/main/ai/prompts.config');
    expect(placeholders(PROMPTS.explain.repair).sort()).toEqual(['input', 'issues', 'previous']);
    expect(placeholders(PROMPTS.structured.cliSystem).sort()).toEqual(['schema', 'system']);
    expect(placeholders(PROMPTS.explain.system)).toEqual([]);
    expect(fill(PROMPTS.structured.cliSystem, { system: 'S', schema: '{}' })).toContain('S');
    expect(() => fill('{{missing}}', {})).toThrow(/missing/);
  });
});

describe('Settings patch', () => {
  it('keeps only the fields that were sent, so saving one setting never resets another', async () => {
    const { Channels } = await import('../src/shared/ipc');
    const patch = Channels['settings:set'].parse({ appearance: 'dark' });
    expect(patch).toEqual({ appearance: 'dark' });
    expect('ai' in (patch as object)).toBe(false);
  });

  it('starts with setup not done, and saving setupDone keeps every other setting', async () => {
    const { Channels, SettingsZ } = await import('../src/shared/ipc');
    const fresh = SettingsZ.parse({});
    expect(fresh.setupDone).toBe(false);
    expect(Channels['settings:set'].parse({ setupDone: true })).toEqual({ setupDone: true });
    const done = SettingsZ.parse({ ...fresh, ai: { ...fresh.ai, enabled: true }, setupDone: true });
    expect(done.setupDone).toBe(true);
    expect(done.ai.enabled).toBe(true);
  });
});

describe('Line review comments', () => {
  it('accepts a range comment and rejects a bad commit id', async () => {
    const { Channels } = await import('../src/shared/ipc');
    const ref = { owner: 'o', repo: 'r', number: 1 };
    const ok = Channels['prs:review'].safeParse({ ref, event: 'COMMENT', body: '', commitId: 'a'.repeat(40), comments: [{ path: 'a.tf', line: 12, side: 'RIGHT', startLine: 10, startSide: 'RIGHT', body: 'Why?' }] });
    expect(ok.success).toBe(true);
    expect(Channels['prs:review'].safeParse({ ref, event: 'COMMENT', body: '', commitId: 'main', comments: [] }).success).toBe(false);
    expect(Channels['prs:review'].safeParse({ ref, event: 'COMMENT', body: '', comments: [{ path: 'a.tf', line: 0, side: 'RIGHT', body: 'x' }] }).success).toBe(false);
  });
});
