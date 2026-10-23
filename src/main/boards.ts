// Read-only board connectors: Azure DevOps (Entra ID) and Jira Cloud (API token).
import type { Ticket } from '../shared/model';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { entraToken, loginShellEnv } from './ai/providers';
import { safeFetch } from './net';
import { getSecret, getSettings } from './settings';

export interface TicketDetail {
  title?: string;
  state?: string;
  url?: string;
  criteria?: string[];
}

const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const ADO_SCOPE = `${ADO_RESOURCE}/.default`;

const htmlToLines = (html: string): string[] =>
  html
    .replace(/<\/(li|p|div|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.replace(/^[\s•*-]+/, '').trim())
    .filter((l) => l.length > 3)
    .slice(0, 8);

// ---- Azure DevOps sign-in: Azure CLI (default), a personal access token, or Entra ID ----

let azToken: { value: string; expires: number } | null = null;

function findAz(env: Record<string, string>): string | null {
  const names = process.platform === 'win32' ? ['az.cmd', 'az.exe'] : ['az'];
  const dirs = [...(env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const d of dirs) for (const n of names) if (d && existsSync(join(d, n))) return join(d, n);
  return null;
}

/** A short-lived Azure DevOps token from `az account get-access-token`, reusing your `az login`. */
function azCliToken(tenantId: string): Promise<string> {
  if (azToken && azToken.expires - Date.now() > 5 * 60_000) return Promise.resolve(azToken.value);
  const env = loginShellEnv();
  const az = findAz(env);
  if (!az) return Promise.reject(new Error('Azure CLI (az) not found. Install it (brew install azure-cli) or choose another sign-in method in Settings › Boards.'));
  const args = ['account', 'get-access-token', '--resource', ADO_RESOURCE, '--output', 'json', ...(tenantId ? ['--tenant', tenantId] : [])];
  return new Promise((resolve, reject) => {
    execFile(az, args, { env, timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = `${stderr || err.message}`;
        if (/az login|not logged in|AADSTS|expired|interaction/i.test(msg)) return reject(new Error('The Azure CLI is not signed in (or the sign-in expired). Run "az login" in Terminal, then try again.'));
        return reject(new Error(`Azure CLI failed: ${msg.trim().split('\n').pop()}`));
      }
      try {
        const j = JSON.parse(stdout) as { accessToken: string; expires_on?: number; expiresOn?: string };
        const expires = j.expires_on ? j.expires_on * 1000 : j.expiresOn ? Date.parse(j.expiresOn) : Date.now() + 30 * 60_000;
        azToken = { value: j.accessToken, expires };
        resolve(j.accessToken);
      } catch {
        reject(new Error('The Azure CLI returned an unexpected reply.'));
      }
    });
  });
}

/** The Authorization header for Azure DevOps, using the sign-in method chosen in Settings › Boards. */
async function adoAuth(): Promise<string> {
  const a = getSettings().boards.ado;
  if (a.auth === 'pat') {
    const pat = getSecret('ado');
    if (!pat) throw new Error('No Azure DevOps personal access token saved. Add one in Settings › Boards.');
    return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  }
  if (a.auth === 'entra') return `Bearer ${await entraToken(a.tenantId, a.clientId, ADO_SCOPE)}`;
  return `Bearer ${await azCliToken(a.tenantId)}`;
}

async function adoItem(key: string): Promise<TicketDetail | null> {
  const a = getSettings().boards.ado;
  if (!a.enabled) return null;
  if (!a.org) throw new Error('Azure DevOps organisation is not set in Settings › Boards.');
  const url = `https://dev.azure.com/${encodeURIComponent(a.org)}/_apis/wit/workitems/${encodeURIComponent(key)}?api-version=7.1`;
  const res = await safeFetch(url, { headers: { Authorization: await adoAuth(), Accept: 'application/json' } });
  if (!res.ok) {
    const why = res.status === 401 ? ' (sign-in not accepted)' : res.status === 403 ? ' (no access to this work item)' : res.status === 404 ? ` (work item not found in ${a.org})` : res.status === 203 ? ' (sign-in redirected; sign in again)' : '';
    throw new Error(`Azure DevOps returned ${res.status}${why}.`);
  }
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('Azure DevOps sent a sign-in page instead of the work item. Sign in again (Settings › Boards › Test).');
  const j = (await res.json()) as { fields: Record<string, string>; _links?: { html?: { href: string } } };
  const ac = j.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '';
  return {
    title: j.fields['System.Title'],
    state: j.fields['System.State'],
    url: j._links?.html?.href ?? `https://dev.azure.com/${a.org}/${a.project}/_workitems/edit/${key}`,
    criteria: ac ? htmlToLines(ac) : htmlToLines(j.fields['System.Description'] ?? '').slice(0, 3),
  };
}

function adfText(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'listItem') {
    out.push(adfText({ content: n.content }, []).join(' ').trim());
    return out;
  }
  if (n.text) out.push(n.text);
  for (const c of n.content ?? []) adfText(c, out);
  return out;
}

async function jiraIssue(key: string): Promise<TicketDetail | null> {
  const j = getSettings().boards.jira;
  const tokenValue = getSecret('jira');
  if (!j.enabled || !j.site || !tokenValue) return null;
  const site = j.site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const res = await safeFetch(`https://${site}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,description`, {
    headers: { Authorization: `Basic ${Buffer.from(`${j.email}:${tokenValue}`).toString('base64')}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const i = (await res.json()) as { fields: { summary: string; status?: { name: string }; description?: unknown } };
  const lines = adfText(i.fields.description).filter((l) => l.length > 3);
  return { title: i.fields.summary, state: i.fields.status?.name, url: `https://${site}/browse/${key}`, criteria: lines.slice(0, 6) };
}

/** Ticket titles and criteria from the boards, plus a readable reason for each ticket that could not be loaded. */
export async function ticketDetails(tickets: Ticket[]): Promise<{ details: Record<string, TicketDetail>; errors: Record<string, string> }> {
  const details: Record<string, TicketDetail> = {};
  const errors: Record<string, string> = {};
  // Sign in once before the lookups run in parallel, so only one browser sign-in can open.
  const a = getSettings().boards.ado;
  if (a.enabled && tickets.some((t) => t.system === 'ado')) {
    try {
      await adoAuth();
    } catch (e) {
      for (const t of tickets) if (t.system === 'ado') errors[t.id] = (e as Error).message;
    }
  }
  await Promise.all(
    tickets.slice(0, 10).map(async (t) => {
      if (errors[t.id]) return;
      try {
        const d = t.system === 'ado' ? await adoItem(t.key) : await jiraIssue(t.key);
        if (d) details[t.id] = d;
      } catch (e) {
        // The report still works from PR text; the reason is shown on the ticket.
        errors[t.id] = (e as Error).message;
      }
    }),
  );
  for (const [id, why] of Object.entries(errors)) console.error(`[prsight] ticket ${id} not loaded: ${why}`);
  return { details, errors };
}

export async function testBoard(system: 'ado' | 'jira'): Promise<{ ok: boolean; message: string }> {
  try {
    if (system === 'ado') {
      const a = getSettings().boards.ado;
      if (!a.org) return { ok: false, message: 'Set the organisation first.' };
      const res = await safeFetch(`https://dev.azure.com/${encodeURIComponent(a.org)}/_apis/connectionData?api-version=7.1-preview`, { headers: { Authorization: await adoAuth(), Accept: 'application/json' } });
      const how = { azcli: 'Azure CLI', pat: 'personal access token', entra: 'Entra ID' }[a.auth];
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return { ok: true, message: `Connected to ${a.org} with your ${how}` };
      return { ok: false, message: res.status === 401 || res.status === 203 ? `Azure DevOps didn’t accept the ${how} (${res.status}).${a.auth === 'pat' ? ' Check it hasn’t expired and has Work Items: Read.' : ''}` : `Azure DevOps returned ${res.status}` };
    }
    const j = getSettings().boards.jira;
    const site = j.site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const tok = getSecret('jira');
    if (!site || !tok) return { ok: false, message: 'Set the site, email and API token first.' };
    const res = await safeFetch(`https://${site}/rest/api/3/myself`, { headers: { Authorization: `Basic ${Buffer.from(`${j.email}:${tok}`).toString('base64')}` } });
    return res.ok ? { ok: true, message: `Connected to ${site}` } : { ok: false, message: `Jira returned ${res.status}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A web link for a ticket when the board is not connected (or did not return one):
 * first a link to that ticket written in a PR description or comment, then one built from
 * the Azure DevOps organisation or Jira site in Settings › Boards. Never guesses a host.
 */
export function ticketUrl(t: Ticket, texts: string[]): string | undefined {
  const k = esc(t.key);
  const re =
    t.system === 'ado'
      ? new RegExp(`https://(?:dev\\.azure\\.com|[\\w-]+\\.visualstudio\\.com)/[^\\s)\\]"'<>]*?_workitems/edit/${k}(?![\\d])`, 'i')
      : new RegExp(`https://[\\w.-]+/browse/${k}(?![\\d])`, 'i');
  for (const x of texts) {
    const m = x.match(re);
    if (m) return m[0];
  }
  const s = getSettings().boards;
  if (t.system === 'ado' && s.ado.org) return `https://dev.azure.com/${encodeURIComponent(s.ado.org)}/${s.ado.project ? `${encodeURIComponent(s.ado.project)}/` : ''}_workitems/edit/${encodeURIComponent(t.key)}`;
  if (t.system === 'jira' && s.jira.site) return `https://${s.jira.site.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/browse/${encodeURIComponent(t.key)}`;
  if (t.system === 'ado') {
    const op = adoProjectIn(texts);
    if (op) return `https://dev.azure.com/${encodeURIComponent(op.org)}/${encodeURIComponent(op.project)}/_workitems/edit/${encodeURIComponent(t.key)}`;
  }
  return undefined;
}

/** The Azure DevOps organisation and project most often linked in these texts (descriptions, comments, changed files). */
export function adoProjectIn(texts: string[]): { org: string; project: string } | null {
  const count = new Map<string, number>();
  const re = /https:\/\/(?:dev\.azure\.com\/([\w.-]+)|([\w-]+)\.visualstudio\.com)\/([^\s/?#)\]"'<>]+)/g;
  for (const x of texts)
    for (const m of x.matchAll(re)) {
      const org = m[1] ?? m[2];
      const project = decodeURIComponent(m[3]);
      if (!org || project.startsWith('_') || /\.(git|ya?ml|json)$/i.test(project)) continue;
      const k = `${org}\u0000${project}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [org, project] = best[0].split('\u0000');
  return { org, project };
}
