import type { TerminalDesign } from "./model";

/** Keep all publish/security build flags centralized and fail-closed. */
import {
  ACCOUNT_DELETION_UI_ENABLED, OFFLINE_DEMO_MODE, PUBLIC_API_ORIGIN,
  PUBLISH_PILOT_MODE, PUBLISH_UI_ENABLED
} from "./publish-config";
export {
  ACCOUNT_DELETION_UI_ENABLED, OFFLINE_DEMO_MODE, PUBLIC_API_ORIGIN,
  PUBLISH_PILOT_MODE, PUBLISH_UI_ENABLED
} from "./publish-config";
const OAUTH_VERIFIER = "workshop-publish-oauth-verifier";
const OAUTH_STATE = "workshop-publish-oauth-state";

export interface PublishUser { id: number; login: string }
export interface PublishSession {
  accessToken: string;
  user: PublishUser;
  expiresAt: string;
}
export interface PublishedCounter {
  slug: string;
  imageUrl: string;
  hits: number;
  createdAt: string;
  design: TerminalDesign;
}
export interface CounterList { counters: PublishedCounter[]; maxCounters: number }
export interface PublishedResult { slug: string; imageUrl: string; markdown: string }
/** A local download snapshot, not a server-side archive or automatic restore. */
export interface PublishedAccountExport {
  formatVersion: 1;
  exportedAt: string;
  account: { githubId: number; githubLogin: string };
  maxCounters: number;
  counters: PublishedCounter[];
}

export function markdownEmbed(imageUrl: string): string {
  if (!PUBLIC_API_ORIGIN || !imageUrl.startsWith(PUBLIC_API_ORIGIN + "/v1/counters/") ||
      !/^https:\/\/[^()\s]+\.(?:workers\.dev)\/v1\/counters\/v[a-f0-9]{24}\.svg$/.test(imageUrl)) {
    throw Error("Invalid hosted counter URL");
  }
  return "![Visitor counter](" + imageUrl + ")";
}

function randomVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function pkce(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function api<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown,
  accessToken?: string): Promise<T> {
  if (!PUBLISH_UI_ENABLED) throw Error("Publishing is not available.");
  const response = await fetch(PUBLIC_API_ORIGIN + path, {
    method, mode: "cors", credentials: "omit", cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000)
  });
  const parsed: unknown = await response.json();
  if (!response.ok) {
    const reason = parsed && typeof parsed === "object" && "error" in parsed &&
      typeof parsed.error === "string" ? parsed.error : "Request failed";
    throw Error(reason);
  }
  return parsed as T;
}

/** Save PKCE verifier/state only until GitHub redirects back. */
export async function beginGitHubLogin(): Promise<void> {
  if (!PUBLISH_UI_ENABLED) throw Error("Publishing is not available.");
  const verifier = randomVerifier();
  const start = await api<{ authorizeUrl: string; state: string }>(
    "/v1/auth/github/start", "POST", { challenge: await pkce(verifier) }
  );
  const address = new URL(start.authorizeUrl);
  if (address.origin !== "https://github.com" ||
      address.pathname !== "/login/oauth/authorize" ||
      !/^[a-f0-9]{64}$/.test(start.state)) {
    throw Error("Unexpected GitHub authorization URL");
  }
  sessionStorage.setItem(OAUTH_VERIFIER, verifier);
  sessionStorage.setItem(OAUTH_STATE, start.state);
  window.location.assign(address.toString());
}

export function readOAuthReturn(): { ticket: string; state: string } | null {
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get("auth_ticket");
  const state = url.searchParams.get("auth_state");
  if (!ticket && !state) return null;
  // Remove the one-use ticket from the address bar/history immediately.
  url.searchParams.delete("auth_ticket");
  url.searchParams.delete("auth_state");
  window.history.replaceState(window.history.state, "", url.toString());
  if (!ticket || !state || !/^[a-f0-9]{64}$/.test(ticket) ||
      !/^[a-f0-9]{64}$/.test(state)) throw Error("Invalid sign-in return");
  return { ticket, state };
}

export async function exchangeGitHubReturn(result: {ticket: string; state: string}):
  Promise<PublishSession> {
  const expected = sessionStorage.getItem(OAUTH_STATE);
  const verifier = sessionStorage.getItem(OAUTH_VERIFIER);
  sessionStorage.removeItem(OAUTH_STATE);
  sessionStorage.removeItem(OAUTH_VERIFIER);
  if (!PUBLISH_UI_ENABLED || !expected || expected !== result.state || !verifier) {
    throw Error("Sign-in state expired. Please sign in again.");
  }
  return api<PublishSession>("/v1/auth/exchange", "POST", {
    ticket: result.ticket, verifier
  });
}
export async function myCounters(token: string): Promise<CounterList> {
  return api<CounterList>("/v1/my/counters", "GET", undefined, token);
}
export async function publishDesign(token: string, design: TerminalDesign):
  Promise<PublishedResult> {
  return api<PublishedResult>("/v1/my/counters", "POST", { design }, token);
}
export async function savePublished(token: string, slug: string, design: TerminalDesign):
  Promise<PublishedResult> {
  if (!/^v[a-f0-9]{24}$/.test(slug)) throw Error("Invalid counter identifier");
  return api<PublishedResult>("/v1/my/counters/" + slug + "/design", "PUT", { design }, token);
}
export async function deletePublishedCounter(token: string, slug: string): Promise<void> {
  if (!/^v[a-f0-9]{24}$/.test(slug)) throw Error("Invalid counter identifier");
  const result = await api<{ slug: string; deleted: boolean }>(
    "/v1/my/counters/" + slug, "DELETE", { confirm: "DELETE", confirmSlug: slug }, token
  );
  if (result.deleted !== true || result.slug !== slug) {
    throw Error("Counter deletion could not be confirmed");
  }
}

/** Reject a wrong-account, malformed or off-origin export before saving it. */
export function verifyPublishedAccountExport(
  response: unknown, expectedUser: PublishUser,
  expectedOrigin = PUBLIC_API_ORIGIN
): PublishedAccountExport {
  if (!response || typeof response !== "object" || !("formatVersion" in response) ||
      response.formatVersion !== 1 || !("account" in response) ||
      !response.account || typeof response.account !== "object" ||
      !("githubId" in response.account) ||
      response.account.githubId !== expectedUser.id ||
      !("githubLogin" in response.account) ||
      response.account.githubLogin !== expectedUser.login ||
      !("counters" in response) || !Array.isArray(response.counters) ||
      response.counters.length > 3 ||
      !response.counters.every(value => {
        if (!value || typeof value !== "object" ||
            !("slug" in value) || typeof value.slug !== "string" ||
            !/^v[a-f0-9]{24}$/.test(value.slug) ||
            !("imageUrl" in value) || typeof value.imageUrl !== "string" ||
            value.imageUrl !== expectedOrigin + "/v1/counters/" + value.slug + ".svg" ||
            !("design" in value) || !value.design ||
            typeof value.design !== "object" ||
            !("schemaVersion" in value.design) || value.design.schemaVersion !== 1) return false;
        return true;
      })) {
    throw Error("Unexpected account export response");
  }
  return response as PublishedAccountExport;
}

export async function exportPublishedAccount(
  token: string, expectedUser: PublishUser
): Promise<PublishedAccountExport> {
  const response: unknown = await api("/v1/my/export", "GET", undefined, token);
  return verifyPublishedAccountExport(response, expectedUser);
}

/** Permanently revoke all live sessions, but never delete published counters. */
export async function revokeAllPublishedSessions(token: string): Promise<void> {
  const response = await api<{signedOutEverywhere: boolean}>(
    "/v1/auth/logout-all", "POST", { confirm: "LOGOUT_ALL" }, token
  );
  if (response.signedOutEverywhere !== true) {
    throw Error("Account sessions could not be revoked");
  }
}

/** Permanently remove app-owned data for the verified account and revoke all sessions. */
export async function deletePublishedAccount(token: string, exactLogin: string): Promise<void> {
  if (!ACCOUNT_DELETION_UI_ENABLED) throw Error("Account deletion is not available.");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(exactLogin)) {
    throw Error("Invalid GitHub login");
  }
  const result = await api<{
    deleted: boolean; signedOutEverywhere: boolean; deletedCounters: number
  }>("/v1/my/account", "DELETE", {
    confirm: "DELETE_MY_ACCOUNT", confirmLogin: exactLogin
  }, token);
  if (result.deleted !== true || result.signedOutEverywhere !== true ||
      !Number.isSafeInteger(result.deletedCounters) || result.deletedCounters < 0) {
    throw Error("Account deletion could not be confirmed");
  }
}

export async function logoutPublishing(token: string): Promise<void> {
  await api("/v1/auth/logout", "POST", undefined, token);
}
