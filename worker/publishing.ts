/**
 * v0.5 user-owned publishing (behind PUBLISHING_ENABLED).
 *
 * GitHub OAuth code exchange happens ONLY in the Worker. Browser sessions are
 * one-hour opaque bearer tokens stored only in memory; D1 stores SHA-256 hashes.
 * Legacy/admin counters never inherit ownership based on a GitHub login string.
 */
import { sanitizeDesign } from "../src/model";

export interface PublishStatement {
  bind(...args: Array<string | number | null>): PublishStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}
export interface PublishDatabase { prepare(sql: string): PublishStatement }
export interface PublishEnv {
  DB: PublishDatabase;
  PUBLISHING_ENABLED?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  STUDIO_ORIGIN?: string;
  PUBLIC_API_ORIGIN?: string;
  /** Pilot allowlist: verified numeric GitHub user ID; required for enabled auth. */
  PILOT_GITHUB_USER_ID?: string;
  VISIT_HASH_SECRET: string;
}
export interface PublishSession {
  github_user_id: number;
  github_login: string;
  expires_at: number;
}
interface StateRow { challenge: string; expires_at: number }
interface TicketRow {
  challenge: string; github_user_id: number; github_login: string; expires_at: number;
}
interface CounterRecord { slug: string; hits: number; design_json: string; created_at: string }

export const SESSION_MS = 60 * 60_000;
const OAUTH_STATE_MS = 10 * 60_000;
const TICKET_MS = 2 * 60_000;
const MAX_COUNTERS_PER_USER = 3;
const MAX_DESIGN_BYTES = 16_000;
const JSON_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const SHA_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const SLUG = /^v[a-f0-9]{24}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function respond(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}
function fail(message: string, status: number): Response { return respond({ error: message }, status); }
function noMethods(methods: string): Response {
  return new Response(null, { status: 405, headers: { ...JSON_HEADERS, Allow: methods } });
}
function object(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}
function secureBytes(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
async function keyedSource(secret: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode("oauth-start\0" + ip));
  return Array.from(new Uint8Array(signed), b => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |=
    (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function validateOrigin(raw: string | undefined, requirePath: boolean): string | null {
  if (!raw) return null;
  try {
    const value = new URL(raw);
    if (value.protocol !== "https:" || value.username || value.password ||
        value.search || value.hash || value.port ||
        (requirePath ? value.pathname !== "/workshop-Visitor-Terminal/" : value.pathname !== "/")) {
      return null;
    }
    if (requirePath && value.hostname !== "guitar0788.github.io") return null;
    if (!requirePath && !/^workshop-visitor-terminal-staging\.[a-z0-9-]+\.workers\.dev$/.test(value.hostname)) {
      return null;
    }
    return value.toString();
  } catch { return null; }
}

export function publishingReady(env: PublishEnv): boolean {
  return env.PUBLISHING_ENABLED === "true" &&
    typeof env.GITHUB_CLIENT_ID === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(env.GITHUB_CLIENT_ID) &&
    typeof env.GITHUB_CLIENT_SECRET === "string" && env.GITHUB_CLIENT_SECRET.length >= 16 &&
    typeof env.VISIT_HASH_SECRET === "string" && env.VISIT_HASH_SECRET.length >= 32 &&
    Boolean(env.DB) && Boolean(validateOrigin(env.PUBLIC_API_ORIGIN, false)) &&
    Boolean(validateOrigin(env.STUDIO_ORIGIN, true)) &&
    typeof env.PILOT_GITHUB_USER_ID === "string" &&
    /^[1-9][0-9]{0,15}$/.test(env.PILOT_GITHUB_USER_ID) &&
    Number.isSafeInteger(Number(env.PILOT_GITHUB_USER_ID));
}

export function studioCors(request: Request, env: PublishEnv): Record<string, string> {
  const expected = validateOrigin(env.STUDIO_ORIGIN, true);
  const origin = request.headers.get("Origin");
  if (!expected || !origin || origin !== new URL(expected).origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}
function sameStudio(request: Request, env: PublishEnv): boolean {
  return Boolean(studioCors(request, env)["Access-Control-Allow-Origin"]);
}
async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("Invalid content type");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_DESIGN_BYTES + 1000) {
    throw new Error("JSON too large");
  }
  return JSON.parse(body) as unknown;
}
function verifiedDesign(value: unknown): ReturnType<typeof sanitizeDesign> | null {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.layers)) return null;
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_DESIGN_BYTES) return null;
  return sanitizeDesign(value);
}
function imageUrl(env: PublishEnv, slug: string): string {
  return validateOrigin(env.PUBLIC_API_ORIGIN, false)! + "v1/counters/" + slug + ".svg";
}
function asList(row: CounterRecord, env: PublishEnv) {
  return {
    slug: row.slug, hits: row.hits,
    createdAt: row.created_at, imageUrl: imageUrl(env, row.slug),
    design: JSON.parse(row.design_json) as unknown
  };
}
async function session(request: Request, env: PublishEnv, now: number): Promise<PublishSession | null> {
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    "SELECT github_user_id, github_login, expires_at FROM publish_sessions WHERE session_hash = ?"
  ).bind(await digest(token)).first<PublishSession>();
  // A pilot allowlist change must revoke existing sessions immediately.
  // Do not rely on the GitHub ID check performed only during OAuth login.
  if (!row || row.expires_at <= now ||
      row.github_user_id !== Number(env.PILOT_GITHUB_USER_ID)) return null;
  return row;
}
function noReferrerRedirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function oauthStart(request: Request, env: PublishEnv, now: number): Promise<Response> {
  if (request.method !== "POST") return noMethods("POST");
  const payload = await jsonBody(request);
  if (!object(payload) || typeof payload.challenge !== "string" ||
      !SHA_CHALLENGE.test(payload.challenge)) return fail("Invalid PKCE challenge", 400);
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 80) return fail("Source address unavailable", 429);
  // HMAC-based 3 OAuth starts per IP in 5 minutes: no raw addresses persisted.
  const source = await keyedSource(env.VISIT_HASH_SECRET, ip);
  const state = secureBytes(32);
  const inserted = await env.DB.prepare(
    "INSERT INTO publish_oauth_states (state_hash, challenge, source_hash, created_at, expires_at) " +
    "SELECT ?, ?, ?, ?, ? WHERE " +
    "(SELECT COUNT(*) FROM publish_oauth_states WHERE source_hash = ? AND created_at >= ?) < 3"
  ).bind(await digest(state), payload.challenge, source, now,
    now + OAUTH_STATE_MS, source, now - 5 * 60_000).run();
  if (!inserted.success) throw new Error("OAuth state write failed");
  if ((inserted.meta?.changes ?? 0) === 0) return fail("Too many login attempts", 429);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  authorize.searchParams.set("redirect_uri", validateOrigin(env.PUBLIC_API_ORIGIN, false)! +
    "v1/auth/github/callback");
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("state", state);
  return respond({ authorizeUrl: authorize.toString(), state, expiresIn: 600 });
}

export async function oauthCallback(
  request: Request, env: PublishEnv, now: number, fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (request.method !== "GET") return noMethods("GET");
  const params = new URL(request.url).searchParams;
  const code = params.get("code"), state = params.get("state");
  if (!code || !state || !/^[a-f0-9]{64}$/.test(state) ||
      code.length > 1024 || params.has("error")) return fail("GitHub authorization not completed", 400);
  const stateHash = await digest(state);
  const matched = await env.DB.prepare(
    "SELECT challenge, expires_at FROM publish_oauth_states WHERE state_hash = ?"
  ).bind(stateHash).first<StateRow>();
  if (!matched || matched.expires_at <= now) return fail("Expired or invalid login state", 401);
  const removed = await env.DB.prepare(
    "DELETE FROM publish_oauth_states WHERE state_hash = ? AND expires_at > ?"
  ).bind(stateHash, now).run();
  if (!removed.success || (removed.meta?.changes ?? 0) !== 1) {
    return fail("Login state already used", 401);
  }
  // Exchange the OAuth code only on the server. Never return the GitHub token.
  const oauth = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!, client_secret: env.GITHUB_CLIENT_SECRET!,
      code, redirect_uri: validateOrigin(env.PUBLIC_API_ORIGIN, false)! +
        "v1/auth/github/callback"
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!oauth.ok) return fail("GitHub authorization unavailable", 502);
  const tokenData: unknown = await oauth.json();
  if (!object(tokenData) || typeof tokenData.access_token !== "string" ||
      tokenData.access_token.length < 10) return fail("GitHub authorization rejected", 401);
  const github = await fetchImpl("https://api.github.com/user", {
    headers: {
      Authorization: "Bearer " + tokenData.access_token,
      Accept: "application/vnd.github+json",
      "User-Agent": "Workshop-Visitor-Terminal"
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!github.ok) return fail("GitHub identity unavailable", 502);
  const profile: unknown = await github.json();
  if (!object(profile) ||
      typeof profile.id !== "number" || !Number.isSafeInteger(profile.id) || profile.id <= 0 ||
      typeof profile.login !== "string" || !LOGIN.test(profile.login)) {
    return fail("Invalid verified GitHub identity", 502);
  }
  // The beta is a single-account OAuth pilot. The verified immutable GitHub
  // numeric ID is compared after the GitHub API call; a matching login string
  // or a forged browser header can never bypass this server-side check.
  if (profile.id !== Number(env.PILOT_GITHUB_USER_ID)) {
    return fail("This beta is restricted to the approved test account", 403);
  }
  const ticket = secureBytes(32);
  const issued = await env.DB.prepare(
    "INSERT INTO publish_login_tickets (ticket_hash, challenge, github_user_id, github_login, expires_at) " +
    "VALUES (?, ?, ?, ?, ?)"
  ).bind(await digest(ticket), matched.challenge, profile.id, profile.login,
    now + TICKET_MS).run();
  if (!issued.success) throw new Error("Login ticket write failed");
  const redirect = new URL(validateOrigin(env.STUDIO_ORIGIN, true)!);
  redirect.searchParams.set("auth_ticket", ticket);
  redirect.searchParams.set("auth_state", state);
  return noReferrerRedirect(redirect.toString());
}

async function exchangeTicket(request: Request, env: PublishEnv, now: number): Promise<Response> {
  if (request.method !== "POST") return noMethods("POST");
  const payload = await jsonBody(request);
  if (!object(payload) || typeof payload.ticket !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.ticket) || typeof payload.verifier !== "string" ||
      !PKCE_VERIFIER.test(payload.verifier)) return fail("Invalid authorization ticket", 400);
  const hash = await digest(payload.ticket);
  const row = await env.DB.prepare(
    "SELECT challenge, github_user_id, github_login, expires_at " +
    "FROM publish_login_tickets WHERE ticket_hash = ?"
  ).bind(hash).first<TicketRow>();
  if (!row || row.expires_at <= now ||
      !safeEqual(await pkceChallenge(payload.verifier), row.challenge)) {
    return fail("Expired or invalid authorization ticket", 401);
  }
  const used = await env.DB.prepare(
    "DELETE FROM publish_login_tickets WHERE ticket_hash = ? AND expires_at > ?"
  ).bind(hash, now).run();
  if (!used.success || (used.meta?.changes ?? 0) !== 1) return fail("Ticket already used", 401);
  const token = secureBytes(32);
  const stored = await env.DB.prepare(
    "INSERT INTO publish_sessions (session_hash, github_user_id, github_login, created_at, expires_at) " +
    "VALUES (?, ?, ?, ?, ?)"
  ).bind(await digest(token), row.github_user_id, row.github_login,
    now, now + SESSION_MS).run();
  if (!stored.success) throw new Error("Session create failed");
  return respond({
    accessToken: token,
    expiresAt: new Date(now + SESSION_MS).toISOString(),
    user: { id: row.github_user_id, login: row.github_login }
  });
}

async function ownCounters(env: PublishEnv, user: PublishSession): Promise<CounterRecord[]> {
  const list = await env.DB.prepare(
    "SELECT slug, hits, design_json, created_at FROM counters " +
    "WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 4"
  ).bind(user.github_user_id).all<CounterRecord>();
  if (!list.success) throw new Error("List own counters failed");
  return list.results;
}

async function listMine(env: PublishEnv, user: PublishSession): Promise<Response> {
  const list = await ownCounters(env, user);
  return respond({
    counters: list.map(row => asList(row, env)),
    maxCounters: MAX_COUNTERS_PER_USER
  });
}

/** A portable snapshot of only this verified account's published counters.
 * Never expose session hashes, OAuth states, private receipt fingerprints or
 * any other account's counters. No server-side export file is persisted.
 */
async function exportMine(env: PublishEnv, user: PublishSession, now: number): Promise<Response> {
  const rows = await ownCounters(env, user);
  return respond({
    formatVersion: 1,
    exportedAt: new Date(now).toISOString(),
    account: { githubId: user.github_user_id, githubLogin: user.github_login },
    maxCounters: MAX_COUNTERS_PER_USER,
    counters: rows.map(row => asList(row, env))
  });
}
async function createMine(request: Request, env: PublishEnv, user: PublishSession, now: number): Promise<Response> {
  const data = await jsonBody(request);
  const design = object(data) ? verifiedDesign(data.design) : null;
  if (!design) return fail("Invalid design", 400);
  for (let i = 0; i < 3; i++) {
    const slug = "v" + secureBytes(12);
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO counters " +
      "(slug, owner, owner_user_id, design_json, created_at) " +
      "SELECT ?, ?, ?, ?, ? WHERE " +
      "(SELECT COUNT(*) FROM counters WHERE owner_user_id = ?) < ?"
    ).bind(slug, user.github_login, user.github_user_id, JSON.stringify(design),
      new Date(now).toISOString(), user.github_user_id, MAX_COUNTERS_PER_USER).run();
    if (!result.success) throw new Error("Publish D1 insert failed");
    if ((result.meta?.changes ?? 0) === 1) return respond({
      slug, imageUrl: imageUrl(env, slug),
      markdown: "![Visitor counter](" + imageUrl(env, slug) + ")"
    }, 201);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM counters WHERE owner_user_id = ?"
    ).bind(user.github_user_id).first<{ total: number }>();
    if ((count?.total ?? 0) >= MAX_COUNTERS_PER_USER) {
      return fail("Maximum of 3 published counters per account", 409);
    }
  }
  return fail("Please retry publishing", 503);
}
async function editMine(
  request: Request, env: PublishEnv, user: PublishSession, slug: string
): Promise<Response> {
  if (!SLUG.test(slug)) return fail("Counter not found", 404);
  const data = await jsonBody(request);
  const design = object(data) ? verifiedDesign(data.design) : null;
  if (!design) return fail("Invalid design", 400);
  const saved = await env.DB.prepare(
    "UPDATE counters SET design_json = ? WHERE slug = ? AND owner_user_id = ?"
  ).bind(JSON.stringify(design), slug, user.github_user_id).run();
  if (!saved.success) throw new Error("Publish D1 update failed");
  if ((saved.meta?.changes ?? 0) !== 1) return fail("Counter not found", 404);
  return respond({
    slug, saved: true, imageUrl: imageUrl(env, slug),
    markdown: "![Visitor counter](" + imageUrl(env, slug) + ")"
  });
}
/**
 * Permanent removal. Require both an authenticated owner and an explicit
 * typed slug in a JSON DELETE request. The D1 foreign-key constraint on
 * request_windows cascades request receipts; published URLs cannot be reused.
 * This operation deliberately does not touch any other counter or session.
 */
async function deleteMine(
  request: Request, env: PublishEnv, user: PublishSession, slug: string
): Promise<Response> {
  if (!SLUG.test(slug)) return fail("Counter not found", 404);
  const payload = await jsonBody(request);
  if (!object(payload) || payload.confirmSlug !== slug ||
      payload.confirm !== "DELETE") {
    return fail("Confirm deletion with the exact counter ID and DELETE", 400);
  }
  const removed = await env.DB.prepare(
    "DELETE FROM counters WHERE slug = ? AND owner_user_id = ?"
  ).bind(slug, user.github_user_id).run();
  if (!removed.success) throw new Error("Counter deletion failed");
  if ((removed.meta?.changes ?? 0) !== 1) return fail("Counter not found", 404);
  return respond({ slug, deleted: true });
}

/** Revoke every active session belonging to this verified numeric GitHub ID.
 * This does not delete counters, OAuth app credentials or account data.
 */
async function logoutAll(request: Request, env: PublishEnv, user: PublishSession): Promise<Response> {
  const confirmation = await jsonBody(request);
  if (!object(confirmation) || confirmation.confirm !== "LOGOUT_ALL") {
    return fail("Confirm signing out of all devices", 400);
  }
  const deleted = await env.DB.prepare(
    "DELETE FROM publish_sessions WHERE github_user_id = ?"
  ).bind(user.github_user_id).run();
  if (!deleted.success) throw Error("Revoke all sessions failed");
  return respond({ signedOutEverywhere: true });
}

async function logout(request: Request, env: PublishEnv): Promise<Response> {
  if (request.method !== "POST") return noMethods("POST");
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return fail("Unauthorized", 401);
  await env.DB.prepare("DELETE FROM publish_sessions WHERE session_hash = ?")
    .bind(await digest(token)).run();
  return respond({ loggedOut: true });
}

export async function handlePublishingRequest(
  request: Request, env: PublishEnv, now = Date.now(), fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const cors = studioCors(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: sameStudio(request, env) ? 204 : 403,
      headers: { ...JSON_HEADERS, ...cors }
    });
  }
  if (!publishingReady(env)) {
    const response = fail("Publishing is not enabled", 503);
    return new Response(response.body, { status: response.status, headers: { ...response.headers, ...cors } });
  }
  if (path === "/v1/auth/github/callback") {
    try {
      return await oauthCallback(request, env, now, fetchImpl);
    } catch {
      return fail("GitHub sign-in temporarily unavailable", 503);
    }
  }
  // CORS alone is insufficient: origin gate before all browser-authorized routes.
  if (!sameStudio(request, env)) return fail("Forbidden origin", 403);
  let result: Response;
  try {
    if (path === "/v1/auth/github/start") {
      result = await oauthStart(request, env, now);
    } else if (path === "/v1/auth/exchange") {
      result = await exchangeTicket(request, env, now);
    } else if (path === "/v1/auth/logout") {
      result = await logout(request, env);
    } else {
      const user = await session(request, env, now);
      if (!user) {
        result = fail("Sign in required", 401);
      } else if (path === "/v1/me") {
        result = request.method === "GET"
          ? respond({ user: { id: user.github_user_id, login: user.github_login },
            expiresAt: new Date(user.expires_at).toISOString() })
          : noMethods("GET");
      } else if (path === "/v1/auth/logout-all") {
        result = request.method === "POST"
          ? await logoutAll(request, env, user) : noMethods("POST");
      } else if (path === "/v1/my/export") {
        result = request.method === "GET"
          ? await exportMine(env, user, now) : noMethods("GET");
      } else if (path === "/v1/my/counters") {
        result = request.method === "GET"
          ? await listMine(env, user)
          : request.method === "POST"
            ? await createMine(request, env, user, now) : noMethods("GET, POST");
      } else {
        const designMatch = path.match(/^\/v1\/my\/counters\/([^/]+)\/design$/);
        const counterMatch = path.match(/^\/v1\/my\/counters\/([^/]+)$/);
        result = designMatch
          ? (request.method === "PUT"
            ? await editMine(request, env, user, designMatch[1]) : noMethods("PUT"))
          : counterMatch
            ? (request.method === "DELETE"
              ? await deleteMine(request, env, user, counterMatch[1]) : noMethods("DELETE"))
            : fail("Not found", 404);
      }
    }
  } catch (cause) {
    if (cause instanceof SyntaxError || (cause instanceof Error &&
      (cause.message === "Invalid content type" || cause.message === "JSON too large"))) {
      result = fail("Invalid JSON request", 400);
    } else {
      result = fail("Publishing temporarily unavailable", 503);
    }
  }
  return new Response(result.body, {
    status: result.status, headers: { ...result.headers, ...cors }
  });
}

/** Called by existing scheduled maintenance. No user data/counts are deleted. */
export async function prunePublishAuth(env: PublishEnv, now = Date.now()): Promise<void> {
  for (const table of ["publish_oauth_states", "publish_login_tickets", "publish_sessions"]) {
    const result = await env.DB.prepare("DELETE FROM " + table + " WHERE expires_at < ?")
      .bind(now).run();
    if (!result.success) throw Error("Auth cleanup failed");
  }
}
