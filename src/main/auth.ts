// GitHub sign-in: GitHub App device flow (production), or the token of the signed-in gh CLI (for testing before the App is approved).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { AuthStatus, DeviceCode } from '../shared/ipc';
import { forgetViewer, viewer } from './github';
import { safeFetch } from './net';
import { deleteSecret, getSecret, getSettings, setSecret } from './settings';

const run = promisify(execFile);
let via: AuthStatus['via'];

const oauthBase = () => `https://${getSettings().github.host || 'github.com'}`;

export async function status(): Promise<AuthStatus> {
  const clientIdConfigured = !!getSettings().github.clientId;
  if (!getSecret('github')) return { signedIn: false, clientIdConfigured };
  try {
    return { signedIn: true, login: await viewer(), via, clientIdConfigured };
  } catch {
    return { signedIn: false, clientIdConfigured };
  }
}

export async function startDevice(): Promise<DeviceCode> {
  const clientId = getSettings().github.clientId;
  if (!clientId) throw new Error('No GitHub App client ID is configured. Ask your administrator, or sign in with the GitHub CLI for now.');
  const res = await safeFetch(`${oauthBase()}/login/device/code`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId }).toString(),
  });
  const j = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number; error_description?: string };
  if (!res.ok || !j.device_code) throw new Error(j.error_description ?? 'GitHub did not return a device code');
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, interval: j.interval, expiresIn: j.expires_in };
}

export async function pollDevice(deviceCode: string): Promise<{ done: boolean; error?: string; status?: AuthStatus }> {
  const res = await safeFetch(`${oauthBase()}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getSettings().github.clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString(),
  });
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (j.access_token) {
    setSecret('github', j.access_token);
    via = 'device';
    forgetViewer();
    return { done: true, status: await status() };
  }
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { done: false };
  return { done: true, error: j.error_description ?? j.error ?? 'Sign-in failed' };
}

const GH_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'];

/** Uses the token of the GitHub CLI the user is already signed in to. The token goes straight to secure storage. */
export async function useGhCli(): Promise<AuthStatus> {
  const bin = GH_PATHS.find((p) => existsSync(p)) ?? 'gh';
  let out: string;
  try {
    out = (await run(bin, ['auth', 'token'], { timeout: 10_000 })).stdout.trim();
  } catch {
    throw new Error('Could not read a token from the GitHub CLI. Install gh and run "gh auth login" first.');
  }
  if (!/^(gh[opusr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(out)) throw new Error('The GitHub CLI did not return a token.');
  setSecret('github', out);
  via = 'gh';
  forgetViewer();
  return status();
}

export async function useToken(token: string): Promise<AuthStatus> {
  setSecret('github', token.trim());
  via = 'token';
  forgetViewer();
  const s = await status();
  if (!s.signedIn) {
    deleteSecret('github');
    throw new Error('GitHub did not accept that token.');
  }
  return s;
}

export async function signOut(): Promise<AuthStatus> {
  deleteSecret('github');
  forgetViewer();
  via = undefined;
  return status();
}
