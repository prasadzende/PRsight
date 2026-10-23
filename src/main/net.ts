// All network calls go through here. The main process only talks to an allow-list of hosts,
// so a bug cannot send data anywhere else. The renderer has no network access at all (CSP).
import { getSettings } from './settings';

const STATIC_HOSTS = [
  /^api\.github\.com$/,
  /^github\.com$/,
  // Profile pictures (read-only), fetched by main and handed to the window as data URIs.
  /^avatars\.githubusercontent\.com$/,
  /^dev\.azure\.com$/,
  /^[\w-]+\.visualstudio\.com$/,
  /^login\.microsoftonline\.com$/,
  /^api\.atlassian\.com$/,
];

function aiHosts(): RegExp[] {
  const s = getSettings();
  if (!s.ai.enabled) return [];
  const host = (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  };
  const list: RegExp[] = [];
  switch (s.ai.provider) {
    case 'anthropic':
      list.push(/^api\.anthropic\.com$/);
      break;
    case 'openai':
      list.push(/^api\.openai\.com$/);
      break;
    case 'gemini':
      list.push(/^generativelanguage\.googleapis\.com$/);
      break;
    case 'azureopenai':
      if (host(s.ai.azureOpenAI.endpoint)) list.push(new RegExp(`^${escape(host(s.ai.azureOpenAI.endpoint))}$`));
      break;
    case 'foundry':
      if (host(s.ai.foundry.endpoint)) list.push(new RegExp(`^${escape(host(s.ai.foundry.endpoint))}$`));
      break;
    case 'bedrock':
      list.push(/^bedrock-runtime\.[\w-]+\.amazonaws\.com$/);
      break;
    case 'vertex':
      list.push(/^[\w-]+-aiplatform\.googleapis\.com$/, /^oauth2\.googleapis\.com$/);
      break;
  }
  return list;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function allowedHosts(): RegExp[] {
  const s = getSettings();
  const extra: RegExp[] = [];
  if (s.github.host && s.github.host !== 'github.com') extra.push(new RegExp(`^${escape(s.github.host)}$`));
  if (s.boards.jira.enabled && s.boards.jira.site) extra.push(new RegExp(`^${escape(s.boards.jira.site.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))}$`));
  if (s.privacy.updateCheck !== 'off' && s.privacy.updateFeed) {
    try {
      extra.push(new RegExp(`^${escape(new URL(s.privacy.updateFeed).hostname)}$`));
    } catch {
      /* invalid feed is ignored */
    }
  }
  return [...STATIC_HOSTS, ...extra, ...aiHosts()];
}

export class BlockedHostError extends Error {}

export function assertAllowed(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new BlockedHostError(`Only HTTPS is allowed: ${u.protocol}`);
  if (!allowedHosts().some((r) => r.test(u.hostname))) throw new BlockedHostError(`Blocked: ${u.hostname} is not on the app's allow-list`);
}

/** fetch() limited to allow-listed hosts. */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  assertAllowed(url);
  return fetch(url, { ...init, redirect: 'manual' }).then(async (res) => {
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location')!, url).toString();
      assertAllowed(next);
      return fetch(next, { ...init, redirect: 'manual' });
    }
    return res;
  });
}
