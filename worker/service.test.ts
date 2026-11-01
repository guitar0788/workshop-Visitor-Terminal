import { describe, expect, it } from "vitest";
import { clonePreset } from "../src/model";
import {
  fingerprint, handleRequest, pruneReceipts,
  type CounterRow, type D1Binding, type D1Statement, type WorkerEnv
} from "./service";

const BASE_URL = "https://counter.example.test";
const TOKEN = "admin-secret-" + "a".repeat(40);
const HASH = "hmac-secret-" + "b".repeat(40);
const NOW = Date.parse("2026-10-31T12:00:00Z");

class MemoryD1 implements D1Binding {
  counters = new Map<string, CounterRow>();
  windows = new Set<string>();
  budgets = new Map<number, number>();
  prepare(query: string): D1Statement {
    let args: Array<string | number | null> = [];
    const statement: D1Statement = {
      bind(...values) { args = values; return statement; },
      async first<T>() {
        if (query.startsWith("SELECT accepted FROM visit_day_budget")) {
          return (db.budgets.get(Number(args[0])) === undefined
            ? null : { accepted: db.budgets.get(Number(args[0])) }) as T | null;
        }
        if (query.startsWith("SELECT ")) {
          return (db.counters.get(String(args[0])) ?? null) as T | null;
        }
        throw Error("Unrecognized SELECT: " + query);
      },
      async all<T>() {
        if (query === "SELECT slug, hits FROM counters ORDER BY slug LIMIT 101") {
          const rows = [...db.counters.values()]
            .sort((a, b) => a.slug.localeCompare(b.slug))
            .slice(0, 101).map(row => ({ slug: row.slug, hits: row.hits }));
          return { results: rows as unknown as T[], success: true };
        }
        return { results: [] as T[], success: true };
      },
      async run() {
        let changes = 0;
        if (query.startsWith("INSERT OR IGNORE INTO counters")) {
          const [slug, owner, design_json, created_at] = args as string[];
          if (!db.counters.has(slug)) {
            db.counters.set(slug, {
              slug, owner, design_json, created_at, hits: 0,
              baseline_hits: 0, baseline_source: null,
              baseline_captured_at: null, baseline_applied_at: null
            });
            changes = 1;
          }
        } else if (query.startsWith("INSERT OR IGNORE INTO request_windows")) {
          const [slug, hash, bucket] = args;
          const key = [slug, hash, bucket].join("|");
          const row = db.counters.get(String(slug));
          if (!db.windows.has(key) && row) {
            db.windows.add(key);
            // Mirrors the AFTER INSERT trigger in migration 0002. The receipt
            // and the increment are one atomic D1 transaction.
            if (row.hits < 999_999_999_999) row.hits++;
            changes = 1;
          }
        } else if (query.startsWith("UPDATE counters SET design_json")) {
          const row = db.counters.get(String(args[1]));
          if (row) { row.design_json = String(args[0]); changes = 1; }
        } else if (query.startsWith("UPDATE counters SET hits = ?")) {
          const row = db.counters.get(String(args[5]));
          if (row && row.hits === 0 && row.baseline_applied_at === null) {
            row.hits = Number(args[0]);
            row.baseline_hits = Number(args[1]);
            row.baseline_source = String(args[2]);
            row.baseline_captured_at = String(args[3]);
            row.baseline_applied_at = String(args[4]);
            changes = 1;
          }
        } else if (query.startsWith("DELETE FROM publish_")) {
          changes = 0; // v0.5 empty auth tables in v0.4 compatibility tests
        } else if (query.startsWith("DELETE FROM request_windows")) {
          const oldest = Number(args[0]);
          for (const item of db.windows) {
            if (Number(item.split("|")[2]) < oldest) { db.windows.delete(item); changes++; }
          }
        } else if (query.startsWith("DELETE FROM visit_day_budget")) {
          // The in-memory double only tracks existing receipt windows.
          changes = 0;
        } else {
          throw Error("Unknown SQL: " + query);
        }
        return { success: true, meta: { changes } };
      }
    };
    const db = this;
    return statement;
  }
}

const setup = (): WorkerEnv & { DB: MemoryD1 } => {
  const DB = new MemoryD1();
  return { DB, ADMIN_TOKEN: TOKEN, VISIT_HASH_SECRET: HASH };
};
const adminRequest = (path: string, body?: unknown, token = TOKEN, method = "POST") =>
  new Request(BASE_URL + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) })
  });
const publicRequest = (path: string, ip?: string, method = "GET") =>
  new Request(BASE_URL + path, {
    method, headers: ip ? { "CF-Connecting-IP": ip } : {}
  });
async function register(env: WorkerEnv, slug = "demo"): Promise<Response> {
  return handleRequest(adminRequest("/v1/admin/counters", { slug, owner: "guitar0788" }), env, NOW);
}

describe("Cloudflare D1 counter Worker", () => {
  it("reports today's bounded quota only to the authorized administrator", async () => {
    const env = setup();
    env.SVG_RATE_LIMIT_ENABLED = "true";
    const path = "/v1/admin/usage";
    const utcDay = Math.floor(NOW / (24 * 60 * 60_000));
    env.DB.budgets.set(utcDay, 19_999);
    expect((await handleRequest(publicRequest(path), env, NOW)).status).toBe(401);
    expect((await handleRequest(adminRequest(path, undefined, "invalid", "GET"),
      env, NOW)).status).toBe(401);
    expect((await handleRequest(adminRequest(path, {}, TOKEN, "POST"),
      env, NOW)).status).toBe(405);
    const response = await handleRequest(adminRequest(path, undefined, TOKEN, "GET"),
      env, NOW);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      admitted: 19_999, remaining: 1,
      maxDailyAdmitted: 20_000,
      edgeRateLimitsEnabled: true,
      edgeLimitPerMinutePerCounter: 60,
      edgeLimitPerMinutePerLocation: 120
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });


  it("recovers own self-host slugs with an explicit opt-in, but never exposes pilot counters", async () => {
    const env = setup();
    await register(env, "known-slug");
    env.DB.counters.get("known-slug")!.hits = 14;
    const path = "/v1/admin/counters";
    const list = () => handleRequest(adminRequest(path, undefined, TOKEN, "GET"), env, NOW);
    expect((await list()).status).toBe(405);
    env.SELF_HOST_ADMIN_LIST_ENABLED = "true";
    expect((await list()).status).toBe(405);
    env.PUBLISHING_ENABLED = "false";
    expect((await handleRequest(publicRequest(path), env, NOW)).status).toBe(401);
    expect((await handleRequest(adminRequest(path, undefined, "wrong", "GET"), env, NOW)).status).toBe(401);
    expect((await handleRequest(adminRequest(path, undefined, TOKEN, "PUT"), env, NOW)).status).toBe(405);
    const before = env.DB.windows.size;
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      counters: [{ slug: "known-slug", hits: 14 }], truncated: false
    });
    expect(env.DB.windows.size).toBe(before);
    expect(env.DB.counters.get("known-slug")?.hits).toBe(14);
    env.PUBLISHING_ENABLED = "true";
    expect((await list()).status).toBe(405);
  });

  it("bounds read-only listing to 100 sorted counters without designs or owners", async () => {
    const env = setup();
    env.PUBLISHING_ENABLED = "false";
    env.SELF_HOST_ADMIN_LIST_ENABLED = "true";
    for (let i = 110; i >= 0; i--) {
      const slug = "test-" + String(i).padStart(3, "0");
      env.DB.counters.set(slug, {
        slug, owner: "private-owner", hits: i, design_json: "PRIVATE-DESIGN",
        created_at: "2026-11-01", baseline_hits: 0, baseline_source: null,
        baseline_captured_at: null, baseline_applied_at: null
      });
    }
    const response = await handleRequest(adminRequest(
      "/v1/admin/counters", undefined, TOKEN, "GET"), env, NOW);
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("PRIVATE-DESIGN");
    expect(raw).not.toContain("private-owner");
    const parsed = JSON.parse(raw) as { counters: Array<{slug: string; hits: number}>; truncated: boolean };
    expect(parsed.truncated).toBe(true);
    expect(parsed.counters).toHaveLength(100);
    expect(parsed.counters[0].slug).toBe("test-000");
    expect(parsed.counters[99].slug).toBe("test-099");
    expect(env.DB.counters.size).toBe(111);
  });

  it("responds to health without secrets or a database", async () => {
    const response = await handleRequest(publicRequest("/health"), {} as WorkerEnv, NOW);
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("ok");
  });

  it("does not expose public routes when secrets are missing", async () => {
    const env = setup();
    env.ADMIN_TOKEN = "";
    const result = await handleRequest(publicRequest("/v1/counters/demo.svg"), env, NOW);
    expect(result.status).toBe(503);
  });

  it("rejects unauthenticated creation and validates slugs", async () => {
    const env = setup();
    expect((await handleRequest(adminRequest(
      "/v1/admin/counters", { slug: "demo", owner: "guitar0788" }, "wrong"
    ), env, NOW)).status).toBe(401);
    expect(env.DB.counters.size).toBe(0);
    expect((await handleRequest(adminRequest(
      "/v1/admin/counters", { slug: "../evil", owner: "guitar0788" }
    ), env, NOW)).status).toBe(400);
  });

  it("creates one counter and prevents duplicates", async () => {
    const env = setup();
    expect((await register(env)).status).toBe(201);
    expect((await register(env)).status).toBe(409);
    expect(env.DB.counters.get("demo")?.hits).toBe(0);
  });

  it("counts one request per HMAC source and five-minute window", async () => {
    const env = setup();
    await register(env);
    const path = "/v1/counters/demo.svg";
    const first = await handleRequest(publicRequest(path, "203.0.113.1"), env, NOW);
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await first.text()).toContain(">1</text>");
    const repeated = await handleRequest(publicRequest(path, "203.0.113.1"), env, NOW + 1000);
    expect(await repeated.text()).toContain(">1</text>");
    const secondIp = await handleRequest(publicRequest(path, "203.0.113.2"), env, NOW + 1000);
    expect(await secondIp.text()).toContain(">2</text>");
    const future = await handleRequest(publicRequest(path, "203.0.113.1"), env, NOW + 5 * 60_000);
    expect(await future.text()).toContain(">3</text>");
    expect(env.DB.windows.size).toBe(3);
    expect((await fingerprint("203.0.113.1", "demo", HASH)).length).toBe(64);
  });

  it("never double-increments concurrent requests with the same receipt", async () => {
    const env = setup();
    await register(env);
    const path = "/v1/counters/demo.svg";
    const requests = Array.from({ length: 20 }, () =>
      handleRequest(publicRequest(path, "203.0.113.9"), env, NOW));
    const responses = await Promise.all(requests);
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(env.DB.counters.get("demo")?.hits).toBe(1);
    expect(env.DB.windows.size).toBe(1);
  });

  it("guards SVG GET and HEAD before all D1 reads, preserving unaffected API endpoints", async () => {
    const env = setup();
    await register(env);
    const calls: string[] = [];
    env.SVG_RATE_LIMIT_ENABLED = "true";
    env.SVG_GLOBAL_RATE_LIMITER = {
      async limit({ key }) { calls.push("global:" + key); return { success: true }; }
    };
    env.SVG_RATE_LIMITER = {
      async limit({ key }) { calls.push("slug:" + key); return { success: true }; }
    };
    const path = "/v1/counters/demo.svg";
    const served = await handleRequest(publicRequest(path, "203.0.113.10"), env, NOW);
    expect(served.status).toBe(200);
    expect(calls).toEqual(["global:all-svg", "slug:slug:demo"]);
    const before = env.DB.windows.size;
    env.SVG_GLOBAL_RATE_LIMITER = {
      async limit({ key }) { calls.push("blocked:" + key); return { success: false }; }
    };
    const rate = await handleRequest(publicRequest(path, "203.0.113.11"), env, NOW);
    expect(rate.status).toBe(429);
    expect(rate.headers.get("Retry-After")).toBe("60");
    expect(rate.headers.get("Cache-Control")).toBe("no-store");
    expect(rate.headers.get("Content-Type")).toBe("application/json");
    expect(env.DB.windows.size).toBe(before);
    expect(env.DB.counters.get("demo")?.hits).toBe(1);
    expect(calls.at(-1)).toBe("blocked:all-svg");

    // Denied per-counter requests also return before D1, without affecting
    // health or authenticated admin inspection.
    env.SVG_GLOBAL_RATE_LIMITER = { async limit() { return { success: true }; } };
    env.SVG_RATE_LIMITER = { async limit() { return { success: false }; } };
    expect((await handleRequest(publicRequest(path, "203.0.113.12", "HEAD"),
      env, NOW)).status).toBe(429);
    expect(env.DB.windows.size).toBe(before);
    expect((await handleRequest(publicRequest("/health"), env, NOW)).status).toBe(200);
    expect((await handleRequest(adminRequest("/v1/admin/counters/demo",
      undefined, TOKEN, "GET"), env, NOW)).status).toBe(200);
  });

  it("fails closed if SVG protection is explicitly enabled without its bindings", async () => {
    const env = setup();
    await register(env);
    const initial = env.DB.windows.size;
    env.SVG_RATE_LIMIT_ENABLED = "true";
    expect((await handleRequest(publicRequest("/v1/counters/demo.svg",
      "203.0.113.10"), env, NOW)).status).toBe(503);
    expect(env.DB.windows.size).toBe(initial);
    // The regular sandbox/local worker is explicitly disabled by default,
    // retaining backwards-compatible smoke tests and visitor counting.
    env.SVG_RATE_LIMIT_ENABLED = "false";
    expect((await handleRequest(publicRequest("/v1/counters/demo.svg",
      "203.0.113.10"), env, NOW)).status).toBe(200);
    expect(env.DB.windows.size).toBe(initial + 1);
  });

  it("does not increment for HEAD, unknown IP or non-existent counter", async () => {
    const env = setup();
    await register(env);
    expect((await handleRequest(publicRequest(
      "/v1/counters/missing.svg", "203.0.113.1"
    ), env, NOW)).status).toBe(404);
    const head = await handleRequest(publicRequest(
      "/v1/counters/demo.svg", "203.0.113.1", "HEAD"
    ), env, NOW);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    await handleRequest(publicRequest("/v1/counters/demo.svg"), env, NOW);
    expect(env.DB.counters.get("demo")?.hits).toBe(0);
    expect((await handleRequest(publicRequest(
      "/v1/counters/demo.svg", undefined, "POST"
    ), env, NOW)).status).toBe(405);
  });

  it("supports guarded one-time legacy seeding only before any live count", async () => {
    const env = setup();
    await register(env);
    const seedPath = "/v1/admin/counters/demo/legacy";
    const seed = { hits: 103, source: "https://komarev.com/ghpvc/?username=test",
      capturedAt: "2026-10-31T11:00:00Z" };
    const response = await handleRequest(adminRequest(seedPath, seed), env, NOW);
    expect(response.status).toBe(200);
    expect(env.DB.counters.get("demo")?.hits).toBe(103);
    expect((await handleRequest(adminRequest(seedPath, seed), env, NOW)).status).toBe(409);
    const inspected = await handleRequest(
      adminRequest("/v1/admin/counters/demo", undefined, TOKEN, "GET"), env, NOW
    );
    expect((await inspected.json() as { baselineHits: number }).baselineHits).toBe(103);

    const other = setup();
    await register(other);
    await handleRequest(publicRequest("/v1/counters/demo.svg", "203.0.113.4"), other, NOW);
    expect((await handleRequest(adminRequest(seedPath, seed), other, NOW)).status).toBe(409);
  });

  it("checks legacy provenance, timestamp and integer baseline", async () => {
    const env = setup();
    await register(env);
    const path = "/v1/admin/counters/demo/legacy";
    expect((await handleRequest(adminRequest(path, {
      hits: 1.5, source: "https://example.com", capturedAt: "2026-10-31T11:00:00Z"
    }), env, NOW)).status).toBe(400);
    expect((await handleRequest(adminRequest(path, {
      hits: 10, source: "http://example.com", capturedAt: "2026-10-31T11:00:00Z"
    }), env, NOW)).status).toBe(400);
    expect((await handleRequest(adminRequest(path, {
      hits: 10, source: "https://example.com", capturedAt: "2027-10-31T11:00:00Z"
    }), env, NOW)).status).toBe(400);
  });

  it("sanitizes admin design updates before serving SVG", async () => {
    const env = setup();
    await register(env);
    const design = clonePreset("pixel");
    design.layers[0].text = "<script>unsafe</script>";
    const changed = await handleRequest(adminRequest("/v1/admin/counters/demo/design", {
      design: { ...design, background: "javascript:bad", width: 9000 }
    }), env, NOW);
    expect(changed.status).toBe(200);
    const svg = await (await handleRequest(publicRequest("/v1/counters/demo.svg"), env, NOW)).text();
    expect(svg).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("javascript:bad");
    expect(svg).toContain('width="800"');
  });

  it("expires short-term receipts without erasing persistent counters", async () => {
    const env = setup();
    await register(env);
    await handleRequest(publicRequest("/v1/counters/demo.svg", "203.0.113.1"), env, NOW);
    expect(env.DB.windows.size).toBe(1);
    await pruneReceipts(env, NOW + 2 * 24 * 60 * 60_000);
    expect(env.DB.windows.size).toBe(0);
    expect(env.DB.counters.get("demo")?.hits).toBe(1);
  });
});
