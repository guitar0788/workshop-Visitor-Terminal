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
  prepare(query: string): D1Statement {
    let args: Array<string | number | null> = [];
    const statement: D1Statement = {
      bind(...values) { args = values; return statement; },
      async first<T>() {
        if (query.startsWith("SELECT ")) {
          return (db.counters.get(String(args[0])) ?? null) as T | null;
        }
        throw Error("Unrecognized SELECT: " + query);
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
          if (!db.windows.has(key) && db.counters.has(String(slug))) {
            db.windows.add(key);
            changes = 1;
          }
        } else if (query.startsWith("UPDATE counters SET hits = hits + 1")) {
          const row = db.counters.get(String(args[0]));
          if (row && row.hits < Number(args[1])) { row.hits++; changes = 1; }
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
        } else if (query.startsWith("DELETE FROM request_windows")) {
          const oldest = Number(args[0]);
          for (const item of db.windows) {
            if (Number(item.split("|")[2]) < oldest) { db.windows.delete(item); changes++; }
          }
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

const setup = () => {
  const DB = new MemoryD1();
  return { DB, ADMIN_TOKEN: TOKEN, VISIT_HASH_SECRET: HASH } satisfies WorkerEnv;
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
