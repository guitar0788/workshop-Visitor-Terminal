import { clonePreset, renderSvg, sanitizeDesign } from "../src/model";
import { handlePublishingRequest, prunePublishAuth, type PublishEnv } from "./publishing";

// Structural subset of the Cloudflare D1 Worker binding for offline testing.
export interface D1Result { success: boolean; meta?: { changes?: number } }
export interface D1Statement {
  bind(...values: Array<string | number | null>): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<D1Result>;
}
export interface D1Binding { prepare(query: string): D1Statement }
export interface WorkerRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
export interface WorkerEnv extends PublishEnv {
  DB: D1Binding;
  ADMIN_TOKEN: string;
  VISIT_HASH_SECRET: string;
  /** Explicit owner-only pilot flag. Optional in older/local deployments. */
  SVG_RATE_LIMIT_ENABLED?: string;
  /** Self-host-only opt-in; disabled by default in the owner pilot. */
  SELF_HOST_ADMIN_LIST_ENABLED?: string;
  SVG_RATE_LIMITER?: WorkerRateLimiter;
  SVG_GLOBAL_RATE_LIMITER?: WorkerRateLimiter;
}
export interface CounterRow {
  slug: string; owner: string; hits: number; design_json: string;
  created_at: string; baseline_hits: number;
  baseline_source: string | null; baseline_captured_at: string | null;
  baseline_applied_at: string | null;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const WINDOW_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_HITS = 999_999_999_999;
const MAX_BODY_BYTES = 20_000;
const NO_CACHE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin"
};
const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: NO_CACHE });
const error = (message: string, status: number): Response => json({ error: message }, status);
const methodNotAllowed = (allow: string): Response =>
  new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...NO_CACHE, "Content-Type": "application/json", Allow: allow }
  });
const validSlug = (value: string): boolean => SLUG.test(value);
const validOwner = (value: unknown): value is string =>
  typeof value === "string" && OWNER.test(value);
const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_HITS;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function configured(env: WorkerEnv): boolean {
  return Boolean(env.DB) &&
    typeof env.ADMIN_TOKEN === "string" && env.ADMIN_TOKEN.length >= 32 &&
    typeof env.VISIT_HASH_SECRET === "string" && env.VISIT_HASH_SECRET.length >= 32 &&
    env.ADMIN_TOKEN !== env.VISIT_HASH_SECRET;
}
function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let result = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return result === 0;
}
function authorized(request: Request, env: WorkerEnv): boolean {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") === true && safeEqual(header.slice(7), env.ADMIN_TOKEN);
}
async function bodyJson(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("Expected application/json");
  }
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) {
    throw new Error("JSON body exceeds 20 KB");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new Error("JSON body exceeds 20 KB");
  }
  return JSON.parse(text) as unknown;
}
export async function fingerprint(ip: string, slug: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(slug + "\u0000" + ip));
  return Array.from(new Uint8Array(signed),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
async function getCounter(db: D1Binding, slug: string): Promise<CounterRow | null> {
  return db.prepare("SELECT slug, owner, hits, design_json, created_at, baseline_hits, " +
    "baseline_source, baseline_captured_at, baseline_applied_at FROM counters WHERE slug = ?")
    .bind(slug).first<CounterRow>();
}

async function image(request: Request, env: WorkerEnv, slug: string, now: number): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  if (!validSlug(slug)) return error("Invalid counter slug", 400);
  // v0.6: block rapid requests BEFORE they read or write D1.
  // The Cloudflare binding is approximate and scoped per data center; the
  // SQLite global UTC-day budget is a separate atomic admission safeguard.
  if (env.SVG_RATE_LIMIT_ENABLED === "true") {
    if (!env.SVG_GLOBAL_RATE_LIMITER || !env.SVG_RATE_LIMITER) {
      return error("Image protection temporarily unavailable", 503);
    }
    const global = await env.SVG_GLOBAL_RATE_LIMITER.limit({ key: "all-svg" });
    if (!global.success) {
      return new Response(JSON.stringify({ error: "Image request rate exceeded" }), {
        status: 429,
        headers: { ...NO_CACHE, "Content-Type": "application/json", "Retry-After": "60" }
      });
    }
    const counter = await env.SVG_RATE_LIMITER.limit({ key: "slug:" + slug });
    if (!counter.success) {
      return new Response(JSON.stringify({ error: "Image request rate exceeded" }), {
        status: 429,
        headers: { ...NO_CACHE, "Content-Type": "application/json", "Retry-After": "60" }
      });
    }
  }
  const row = await getCounter(env.DB, slug);
  if (!row) return error("Counter not found", 404);
  let hits = row.hits;
  if (request.method === "GET" && hits < MAX_HITS) {
    const ip = request.headers.get("CF-Connecting-IP");
    // Do not store raw IPs or make up counts for requests without a source IP.
    if (ip && ip.length < 80) {
      const bucket = Math.floor(now / WINDOW_MS);
      const hashed = await fingerprint(ip, slug, env.VISIT_HASH_SECRET);
      const receipt = await env.DB.prepare(
        "INSERT OR IGNORE INTO request_windows (slug, fingerprint, bucket) VALUES (?, ?, ?)"
      ).bind(slug, hashed, bucket).run();
      if (!receipt.success) throw new Error("D1 receipt failed");
      // Migration 0002 installs an AFTER INSERT trigger. Receipt creation and
      // increment now happen in a single SQLite transaction (including when
      // concurrent requests race to insert the same receipt).
      // Re-read on both insert and duplicate to avoid stale SVG counts.
      const current = await getCounter(env.DB, slug);
      if (!current) throw new Error("Counter disappeared");
      hits = current.hits;
    }
  }
  const svg = renderSvg(JSON.parse(row.design_json) as unknown, hits);
  return new Response(request.method === "HEAD" ? null : svg, {
    status: 200, headers: SVG_HEADERS
  });
}

async function createCounter(request: Request, env: WorkerEnv, now: number): Promise<Response> {
  const body = await bodyJson(request);
  if (!isObject(body) || typeof body.slug !== "string" ||
      !validSlug(body.slug) || !validOwner(body.owner)) return error("Invalid slug or owner", 400);
  const design = sanitizeDesign(body.design ?? clonePreset("pixel"));
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO counters (slug, owner, design_json, created_at) VALUES (?, ?, ?, ?)"
  ).bind(body.slug, body.owner, JSON.stringify(design), new Date(now).toISOString()).run();
  if (!inserted.success) throw new Error("D1 create failed");
  if ((inserted.meta?.changes ?? 0) === 0) return error("Counter already exists", 409);
  return json({ slug: body.slug, owner: body.owner, hits: 0,
    path: "/v1/counters/" + body.slug + ".svg" }, 201);
}

async function updateDesign(request: Request, env: WorkerEnv, slug: string): Promise<Response> {
  const body = await bodyJson(request);
  if (!isObject(body) || !isObject(body.design)) return error("Missing design object", 400);
  const design = sanitizeDesign(body.design);
  const updated = await env.DB.prepare(
    "UPDATE counters SET design_json = ? WHERE slug = ?"
  ).bind(JSON.stringify(design), slug).run();
  if (!updated.success) throw new Error("D1 update design failed");
  return (updated.meta?.changes ?? 0) ? json({ slug, updated: true }) :
    error("Counter not found", 404);
}

async function seedLegacy(request: Request, env: WorkerEnv, slug: string, now: number): Promise<Response> {
  const body = await bodyJson(request);
  if (!isObject(body) || !validCount(body.hits) ||
      typeof body.source !== "string" || body.source.length > 500 ||
      typeof body.capturedAt !== "string") {
    return error("Provide verified hits, HTTPS source, and capture time", 400);
  }
  let source: URL;
  try { source = new URL(body.source); } catch { return error("Invalid source URL", 400); }
  if (source.protocol !== "https:" || !source.hostname) return error("Legacy source must be HTTPS", 400);
  const captured = Date.parse(body.capturedAt);
  if (!Number.isFinite(captured) || !/^\d{4}-\d{2}-\d{2}T/.test(body.capturedAt) ||
      captured > now + 5 * 60_000) return error("Invalid capture time", 400);
  const updated = await env.DB.prepare(
    "UPDATE counters SET hits = ?, baseline_hits = ?, baseline_source = ?, " +
    "baseline_captured_at = ?, baseline_applied_at = ? " +
    "WHERE slug = ? AND hits = 0 AND baseline_applied_at IS NULL"
  ).bind(body.hits, body.hits, source.toString(),
    new Date(captured).toISOString(), new Date(now).toISOString(), slug).run();
  if (!updated.success) throw new Error("D1 legacy migration failed");
  if ((updated.meta?.changes ?? 0) === 0) return error(
    "Counter missing, active, or baseline already applied", 409
  );
  return json({ slug, baselineHits: body.hits, source: source.toString(), applied: true });
}

async function admin(request: Request, env: WorkerEnv, path: string, now: number): Promise<Response> {
  if (!authorized(request, env)) return error("Unauthorized", 401);
  if (path === "/v1/admin/usage") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const utcDay = Math.floor(now / DAY_MS);
    const status = await env.DB.prepare(
      "SELECT accepted FROM visit_day_budget WHERE utc_day = ?"
    ).bind(utcDay).first<{ accepted: number }>();
    const admitted = status?.accepted ?? 0;
    return json({
      utcDay: new Date(utcDay * DAY_MS).toISOString().slice(0, 10),
      admitted, maxDailyAdmitted: 20_000,
      remaining: Math.max(0, 20_000 - admitted),
      /** Rate limits apply in each Cloudflare location, not globally. */
      edgeRateLimitsEnabled: env.SVG_RATE_LIMIT_ENABLED === "true",
      edgeLimitPerMinutePerCounter: 60,
      edgeLimitPerMinutePerLocation: 120
    });
  }
  if (path === "/v1/admin/counters") {
    if (request.method === "POST") return createCounter(request, env, now);
    if (request.method !== "GET" ||
        env.SELF_HOST_ADMIN_LIST_ENABLED !== "true" ||
        env.PUBLISHING_ENABLED !== "false") return methodNotAllowed("POST");
    // An authenticated, bounded D1 read: never select designs, owners, or receipts.
    const result = await env.DB.prepare(
      "SELECT slug, hits FROM counters ORDER BY slug LIMIT 101"
    ).all<{ slug: string; hits: number }>();
    if (!result.success || !Array.isArray(result.results) ||
        result.results.some(row => !row || !validSlug(row.slug) || !validCount(row.hits))) {
      throw Error("Self-host counter list integrity failure");
    }
    return json({ counters: result.results.slice(0, 100),
      truncated: result.results.length > 100 });
  }
  const match = path.match(/^\/v1\/admin\/counters\/([^/]+)(?:\/(design|legacy))?$/);
  if (!match || !validSlug(match[1])) return error("Not found", 404);
  const slug = match[1], action = match[2];
  if (!action) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const row = await getCounter(env.DB, slug);
    return row ? json({
      slug: row.slug, owner: row.owner, hits: row.hits, createdAt: row.created_at,
      baselineHits: row.baseline_hits, baselineSource: row.baseline_source,
      baselineCapturedAt: row.baseline_captured_at, baselineAppliedAt: row.baseline_applied_at
    }) : error("Counter not found", 404);
  }
  if (request.method !== "POST") return methodNotAllowed("POST");
  return action === "design" ? updateDesign(request, env, slug) :
    seedLegacy(request, env, slug, now);
}

export async function handleRequest(
  request: Request, env: WorkerEnv, now = Date.now()
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/health") {
      return request.method === "GET" ?
        json({ status: "ok", service: "workshop-visitor-terminal", api: "v1" }) :
        methodNotAllowed("GET");
    }
    if (!configured(env)) return error("Service configuration unavailable", 503);
    // v0.5 user routes are separately gated and cannot use ADMIN_TOKEN.
    if (path.startsWith("/v1/auth/") || path === "/v1/me" ||
        path.startsWith("/v1/my/")) {
      return await handlePublishingRequest(request, env, now);
    }
    if (path.startsWith("/v1/admin/")) return await admin(request, env, path, now);
    const match = path.match(/^\/v1\/counters\/([^/]+)\.svg$/);
    return match ? await image(request, env, match[1], now) : error("Not found", 404);
  } catch (cause) {
    if (cause instanceof SyntaxError || cause instanceof TypeError) {
      return error("Invalid request payload", 400);
    }
    if (cause instanceof Error &&
        (cause.message.startsWith("Expected application/json") ||
         cause.message.startsWith("JSON body exceeds"))) {
      return error(cause.message, 400);
    }
    // Internal details, request metadata and secret values never reach visitors.
    return error("Service temporarily unavailable", 503);
  }
}
export async function pruneReceipts(env: WorkerEnv, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM request_windows WHERE bucket < ?")
    .bind(Math.floor((now - DAY_MS) / WINDOW_MS)).run();
  // The UTC-day budget is append-only within a day and bounded at 20k. Delete
  // old budget metadata only; never reset today's limit or counter history.
  await env.DB.prepare("DELETE FROM visit_day_budget WHERE utc_day < ?")
    .bind(Math.floor(now / DAY_MS) - 2).run();
  // Separate OAuth state, ticket, and session cleanup never touches counters.
  await prunePublishAuth(env, now);
}
