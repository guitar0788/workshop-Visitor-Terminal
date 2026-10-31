import { describe, it, expect } from "vitest";
import { clonePreset } from "../src/model";
import {
  handlePublishingRequest, oauthCallback, pkceChallenge, publishingReady,
  type PublishDatabase, type PublishStatement, type PublishEnv
} from "./publishing";

const now = 1793500000000;
const origin = "https://guitar0788.github.io";
const apiOrigin = "https://workshop-visitor-terminal-staging.example.workers.dev/";
const adminSecret = "h".repeat(64);
type DbRow = Record<string, unknown>;

class MockD1 implements PublishDatabase {
  states = new Map<string, DbRow>();
  tickets = new Map<string, DbRow>();
  sessions = new Map<string, DbRow>();
  counters = new Map<string, DbRow>();
  prepare(sql: string): PublishStatement {
    const db = this;
    let args: Array<string | number | null> = [];
    const prepared: PublishStatement = {
      bind(...a) { args = a; return prepared; },
      async first<T>() {
        let row: DbRow | null = null;
        if (sql.startsWith("SELECT challenge, expires_at FROM publish_oauth_states")) {
          row = db.states.get(String(args[0])) ?? null;
        } else if (sql.startsWith("SELECT challenge, github_user_id")) {
          row = db.tickets.get(String(args[0])) ?? null;
        } else if (sql.startsWith("SELECT github_user_id, github_login, expires_at")) {
          row = db.sessions.get(String(args[0])) ?? null;
        } else if (sql.startsWith("SELECT COUNT(*) AS total FROM counters")) {
          row = { total: [...db.counters.values()].filter(x =>
            x.owner_user_id === args[0]).length };
        } else { throw Error("Unexpected D1 first: " + sql); }
        return row as T | null;
      },
      async all<T>() {
        if (!sql.startsWith("SELECT slug, hits, design_json, created_at FROM counters")) {
          throw Error("Unexpected D1 all: " + sql);
        }
        return { results: [...db.counters.values()].filter(x =>
          x.owner_user_id === args[0]) as T[], success: true };
      },
      async run() {
        let changes = 0;
        if (sql.startsWith("INSERT INTO publish_oauth_states")) {
          const [hash, challenge, source, createdAt, expiry, key, since] = args;
          if ([...db.states.values()].filter(x => x.source_hash === key &&
              Number(x.created_at) >= Number(since)).length < 3) {
            db.states.set(String(hash), {
              state_hash: hash, challenge, source_hash: source,
              created_at: createdAt, expires_at: expiry
            });
            changes = 1;
          }
        } else if (sql.startsWith("DELETE FROM publish_oauth_states")) {
          const row = db.states.get(String(args[0]));
          if (row && Number(row.expires_at) > Number(args[1])) {
            db.states.delete(String(args[0])); changes = 1;
          }
        } else if (sql.startsWith("INSERT INTO publish_login_tickets")) {
          db.tickets.set(String(args[0]), {
            challenge: args[1], github_user_id: args[2],
            github_login: args[3], expires_at: args[4]
          }); changes = 1;
        } else if (sql.startsWith("DELETE FROM publish_login_tickets")) {
          const row = db.tickets.get(String(args[0]));
          if (row && Number(row.expires_at) > Number(args[1])) {
            db.tickets.delete(String(args[0])); changes = 1;
          }
        } else if (sql.startsWith("INSERT INTO publish_sessions")) {
          db.sessions.set(String(args[0]), {
            github_user_id: args[1], github_login: args[2],
            created_at: args[3], expires_at: args[4]
          }); changes = 1;
        } else if (sql.startsWith("INSERT OR IGNORE INTO counters")) {
          const [slug, login, id, design, createdAt, owner, maximum] = args;
          if ([...db.counters.values()].filter(x => x.owner_user_id === owner).length <
              Number(maximum) && !db.counters.has(String(slug))) {
            db.counters.set(String(slug), {
              slug, owner: login, owner_user_id: id, design_json: design,
              created_at: createdAt, hits: 0
            }); changes = 1;
          }
        } else if (sql.startsWith("UPDATE counters SET design_json")) {
          const row = db.counters.get(String(args[1]));
          if (row && row.owner_user_id === args[2]) {
            row.design_json = args[0]; changes = 1;
          }
        } else if (sql.startsWith("DELETE FROM counters WHERE slug = ? AND owner_user_id = ?")) {
          const row = db.counters.get(String(args[0]));
          if (row && row.owner_user_id === args[1]) {
            db.counters.delete(String(args[0])); changes = 1;
          }
        } else if (sql.startsWith("DELETE FROM publish_sessions")) {
          changes = db.sessions.delete(String(args[0])) ? 1 : 0;
        } else {
          throw Error("Unexpected D1 run: " + sql);
        }
        return { success: true, meta: { changes } };
      }
    };
    return prepared;
  }
}
const createEnv = (): PublishEnv & { DB: MockD1 } => ({
  DB: new MockD1(),
  PUBLISHING_ENABLED: "true",
  GITHUB_CLIENT_ID: "GithubClientId_123",
  GITHUB_CLIENT_SECRET: "secret-12345678901234567890",
  PILOT_GITHUB_USER_ID: "124379632",
  STUDIO_ORIGIN: "https://guitar0788.github.io/workshop-Visitor-Terminal/",
  PUBLIC_API_ORIGIN: apiOrigin,
  VISIT_HASH_SECRET: adminSecret
});
function req(path: string, method = "GET", payload?: unknown, auth?: string, originValue = origin) {
  return new Request(new URL(path, apiOrigin), {
    method,
    headers: {
      Origin: originValue,
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method === "POST" && path === "/v1/auth/github/start"
        ? { "CF-Connecting-IP": "203.0.113.7" } : {})
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
}
const fakeGithub: typeof fetch = async (input, init) => {
  if (String(input).includes("login/oauth/access_token")) {
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("client_secret");
    return Response.json({ access_token: "gho_abcdef1234567890" });
  }
  if (String(input).includes("api.github.com/user")) {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer gho_abcdef1234567890");
    return Response.json({ id: 124379632, login: "guitar0788" });
  }
  throw Error("Unexpected GitHub endpoint");
};

async function completeLogin(env: ReturnType<typeof createEnv>) {
  const verifier = "correct-verifier-" + "a".repeat(55);
  const challenge = await pkceChallenge(verifier);
  const start = await handlePublishingRequest(
    req("/v1/auth/github/start", "POST", { challenge }), env, now);
  expect(start.status).toBe(200);
  const login = await start.json() as { state: string; authorizeUrl: string };
  expect(new URL(login.authorizeUrl).hostname).toBe("github.com");
  const callback = new Request(apiOrigin + "v1/auth/github/callback?code=github-code&state=" + login.state);
  const sent = await oauthCallback(callback, env, now + 1000, fakeGithub);
  expect(sent.status).toBe(302);
  const resultUrl = new URL(sent.headers.get("Location")!);
  expect(resultUrl.origin).toBe(origin);
  const ticket = resultUrl.searchParams.get("auth_ticket")!;
  const exchanged = await handlePublishingRequest(
    req("/v1/auth/exchange", "POST", { ticket, verifier }), env, now + 1001);
  expect(exchanged.status).toBe(200);
  const session = await exchanged.json() as { accessToken: string; user: {id:number;login:string} };
  return { ...session, ticket, verifier, state: login.state };
}

describe("v0.5 securely gated GitHub OAuth publishing", () => {
  it("remains disabled without complete OAuth settings", async () => {
    const env = createEnv();
    env.PUBLISHING_ENABLED = "false";
    expect(publishingReady(env)).toBe(false);
    expect((await handlePublishingRequest(req("/v1/me"), env, now)).status).toBe(503);
    env.PUBLISHING_ENABLED = "true";
    env.GITHUB_CLIENT_SECRET = "";
    expect(publishingReady(env)).toBe(false);
    env.GITHUB_CLIENT_SECRET = "secret-12345678901234567890";
    env.PILOT_GITHUB_USER_ID = undefined;
    expect(publishingReady(env)).toBe(false);
  });

  it("refuses browser requests from a non-Studio origin", async () => {
    const env = createEnv();
    const result = await handlePublishingRequest(
      req("/v1/auth/github/start", "POST",
        { challenge: await pkceChallenge("x".repeat(55)) },
        undefined, "https://evil.example"), env, now);
    expect(result.status).toBe(403);
    expect(env.DB.states.size).toBe(0);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("uses server-side GitHub token exchange, verified numeric identity and one-use tickets", async () => {
    const env = createEnv();
    const result = await completeLogin(env);
    expect(result.user).toEqual({ id: 124379632, login: "guitar0788" });
    const me = await handlePublishingRequest(req("/v1/me", "GET", undefined, result.accessToken), env, now + 2000);
    expect(me.status).toBe(200);
    expect((await me.json() as {user:{id:number}}).user.id).toBe(124379632);
    expect((await handlePublishingRequest(req("/v1/auth/exchange", "POST",
      { ticket: result.ticket, verifier: result.verifier }), env, now + 2000)).status).toBe(401);
    expect((await handlePublishingRequest(req("/v1/me", "GET", undefined, result.accessToken),
      env, now + 60 * 60_000 + 2000)).status).toBe(401);
  });

  it("refuses an incorrect PKCE verifier without consuming the ticket", async () => {
    const env = createEnv();
    const v = "b".repeat(55);
    const begin = await handlePublishingRequest(req("/v1/auth/github/start", "POST",
      { challenge: await pkceChallenge(v) }), env, now);
    const data = await begin.json() as {state:string};
    const callback = await oauthCallback(new Request(apiOrigin +
      "v1/auth/github/callback?code=oauth-code&state=" + data.state),
      env, now + 500, fakeGithub);
    const ticket = new URL(callback.headers.get("Location")!).searchParams.get("auth_ticket");
    expect((await handlePublishingRequest(req("/v1/auth/exchange", "POST",
      { ticket, verifier: "c".repeat(55) }), env, now + 600)).status).toBe(401);
    expect((await handlePublishingRequest(req("/v1/auth/exchange", "POST",
      { ticket, verifier: v }), env, now + 700)).status).toBe(200);
  });

  it("rate limits login initiation per HMAC source over five minutes", async () => {
    const env = createEnv();
    const challenge = await pkceChallenge("z".repeat(55));
    for (let i = 0; i < 3; i++) expect((await handlePublishingRequest(
      req("/v1/auth/github/start", "POST", { challenge }), env, now)).status).toBe(200);
    expect((await handlePublishingRequest(
      req("/v1/auth/github/start", "POST", { challenge }), env, now)).status).toBe(429);
  });

  it("publishes at most three owned counters, never editing someone else's design", async () => {
    const env = createEnv();
    const logged = await completeLogin(env);
    const design = clonePreset("pixel");
    let slug = "";
    for (let i = 0; i < 3; i++) {
      const response = await handlePublishingRequest(req("/v1/my/counters", "POST",
        { design }, logged.accessToken), env, now + 3000);
      expect(response.status).toBe(201);
      const published = await response.json() as { slug: string; imageUrl: string; markdown: string };
      expect(published.imageUrl).toContain(published.slug + ".svg");
      expect(published.markdown).toContain(published.imageUrl);
      slug = published.slug;
    }
    expect((await handlePublishingRequest(req("/v1/my/counters", "POST",
      { design }, logged.accessToken), env, now + 4000)).status).toBe(409);
    const all = await handlePublishingRequest(req("/v1/my/counters", "GET",
      undefined, logged.accessToken), env, now + 4000);
    expect((await all.json() as {counters:unknown[]}).counters.length).toBe(3);
    // Different verified numeric ID, not guessed from a display name.
    const otherToken = "0".repeat(64);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otherToken));
    const hex = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
    env.DB.sessions.set(hex, { github_user_id: 9, github_login: "someone",
      expires_at: now + 60 * 60_000 });
    // The private pilot must refuse a non-allowlisted account before DB access.
    expect((await handlePublishingRequest(req("/v1/my/counters/" + slug + "/design", "PUT",
      { design }, otherToken), env, now + 5000)).status).toBe(401);
    // Even if that account becomes the allowlisted pilot, SQL ownership still
    // prevents it from editing a counter created by the previous account.
    env.PILOT_GITHUB_USER_ID = "9";
    expect((await handlePublishingRequest(req("/v1/my/counters/" + slug + "/design", "PUT",
      { design }, otherToken), env, now + 5100)).status).toBe(404);
    env.PILOT_GITHUB_USER_ID = "124379632";
    expect((await handlePublishingRequest(req("/v1/my/counters/" + slug + "/design", "PUT",
      { design }, logged.accessToken), env, now + 5200)).status).toBe(200);
  });

  it("keeps published slug and historical hits when updating a live design", async () => {
    const env = createEnv();
    const signedIn = await completeLogin(env);
    const original = clonePreset("pixel");
    const publish = await handlePublishingRequest(
      req("/v1/my/counters", "POST", { design: original }, signedIn.accessToken),
      env, now + 2_000
    );
    expect(publish.status).toBe(201);
    const initial = await publish.json() as {
      slug: string; imageUrl: string; markdown: string
    };
    const stored = env.DB.counters.get(initial.slug);
    expect(stored).toBeDefined();
    if (!stored) throw Error("Newly created counter missing from mock D1");
    // Simulate a counter that has already received qualifying upstream visits.
    stored.hits = 37;
    const updated = clonePreset("pixel");
    const title = updated.layers.find(layer => layer.id === "heading");
    expect(title).toBeDefined();
    if (title) title.text = "V05-STAGING-DESIGN-UPDATED";
    const changed = await handlePublishingRequest(
      req("/v1/my/counters/" + initial.slug + "/design", "PUT",
        { design: updated }, signedIn.accessToken), env, now + 3_000
    );
    expect(changed.status).toBe(200);
    const result = await changed.json() as {
      slug: string; saved: boolean; imageUrl: string; markdown: string
    };
    expect(result.saved).toBe(true);
    expect(result.slug).toBe(initial.slug);
    expect(result.imageUrl).toBe(initial.imageUrl);
    expect(result.markdown).toBe(initial.markdown);
    expect(stored.hits).toBe(37);
    const list = await handlePublishingRequest(
      req("/v1/my/counters", "GET", undefined, signedIn.accessToken),
      env, now + 4_000
    );
    expect(list.status).toBe(200);
    const entries = await list.json() as {
      counters: Array<{slug:string;hits:number;imageUrl:string;design:{
        layers: Array<{id:string;text:string}>
      }}>
    };
    expect(entries.counters).toHaveLength(1);
    expect(entries.counters[0].slug).toBe(initial.slug);
    expect(entries.counters[0].imageUrl).toBe(initial.imageUrl);
    expect(entries.counters[0].hits).toBe(37);
    expect(entries.counters[0].design.layers.find(layer => layer.id === "heading")?.text)
      .toBe("V05-STAGING-DESIGN-UPDATED");
  });

  it("denies anonymous reads and writes, foreign browser origins and revoked sessions", async () => {
    const env = createEnv();
    const logged = await completeLogin(env);
    const design = clonePreset("pixel");
    const created = await handlePublishingRequest(
      req("/v1/my/counters", "POST", { design }, logged.accessToken),
      env, now + 2_000
    );
    expect(created.status).toBe(201);
    const { slug } = await created.json() as { slug: string };
    const originalJson = env.DB.counters.get(slug)?.design_json;
    const altered = clonePreset("pixel");
    const alteredHeading = altered.layers.find(layer => layer.id === "heading");
    if (alteredHeading) alteredHeading.text = "MUST-NOT-BE-WRITTEN";

    expect((await handlePublishingRequest(
      req("/v1/my/counters", "GET"), env, now + 3_000
    )).status).toBe(401);
    expect((await handlePublishingRequest(
      req("/v1/my/counters/" + slug + "/design", "PUT", { design: altered }),
      env, now + 3_100
    )).status).toBe(401);
    const foreign = await handlePublishingRequest(
      req("/v1/my/counters/" + slug + "/design", "PUT",
        { design: altered }, logged.accessToken, "https://attacker.example"),
      env, now + 3_200
    );
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(env.DB.counters.get(slug)?.design_json).toBe(originalJson);

    expect((await handlePublishingRequest(
      req("/v1/auth/logout", "POST", undefined, logged.accessToken),
      env, now + 4_000
    )).status).toBe(200);
    expect((await handlePublishingRequest(
      req("/v1/my/counters", "GET", undefined, logged.accessToken),
      env, now + 4_100
    )).status).toBe(401);
    expect((await handlePublishingRequest(
      req("/v1/my/counters/" + slug + "/design", "PUT",
        { design: altered }, logged.accessToken),
      env, now + 4_200
    )).status).toBe(401);
    expect(env.DB.counters.get(slug)?.design_json).toBe(originalJson);

    // A new verified sign-in recovers the same D1 counter, not a fresh one.
    const signedInAgain = await completeLogin(env);
    const mine = await handlePublishingRequest(
      req("/v1/my/counters", "GET", undefined, signedInAgain.accessToken),
      env, now + 5_000
    );
    expect(mine.status).toBe(200);
    const records = await mine.json() as {counters:Array<{slug:string}>};
    expect(records.counters.map(counter => counter.slug)).toContain(slug);
  });

  it("requires exact typed confirmation and owner session before deleting a counter", async () => {
    const env = createEnv();
    const logged = await completeLogin(env);
    const initial = await handlePublishingRequest(
      req("/v1/my/counters", "POST", { design: clonePreset("pixel") },
        logged.accessToken), env, now + 2000
    );
    expect(initial.status).toBe(201);
    const { slug } = await initial.json() as { slug: string };
    const endpoint = "/v1/my/counters/" + slug;
    env.DB.counters.get(slug)!.hits = 65;
    for (const bad of [
      undefined, {}, { confirm: "DELETE", confirmSlug: "wrong" },
      { confirm: "delete", confirmSlug: slug },
      { confirm: "DELETE", confirmSlug: slug.toUpperCase() }
    ]) {
      const response = await handlePublishingRequest(
        req(endpoint, "DELETE", bad, logged.accessToken), env, now + 3000
      );
      expect(response.status).toBe(400);
      expect(env.DB.counters.get(slug)?.hits).toBe(65);
    }
    const confirmation = { confirm: "DELETE", confirmSlug: slug };
    expect((await handlePublishingRequest(
      req(endpoint, "DELETE", confirmation), env, now + 4000
    )).status).toBe(401);
    expect((await handlePublishingRequest(
      req(endpoint, "DELETE", confirmation, logged.accessToken, "https://foreign.example"),
      env, now + 4001
    )).status).toBe(403);
    expect(env.DB.counters.get(slug)?.hits).toBe(65);

    const removed = await handlePublishingRequest(
      req(endpoint, "DELETE", confirmation, logged.accessToken), env, now + 5000
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ slug, deleted: true });
    expect(env.DB.counters.has(slug)).toBe(false);
    expect((await handlePublishingRequest(
      req(endpoint, "DELETE", confirmation, logged.accessToken), env, now + 5001
    )).status).toBe(404);
    expect((await handlePublishingRequest(
      req(endpoint + "/design", "PUT", { design: clonePreset("cyber") },
        logged.accessToken), env, now + 5002
    )).status).toBe(404);
    const list = await handlePublishingRequest(
      req("/v1/my/counters", "GET", undefined, logged.accessToken),
      env, now + 6000
    );
    expect((await list.json() as {counters:unknown[]}).counters).toHaveLength(0);
  });

  it("never deletes another account's or legacy/admin counters and frees only owned quota", async () => {
    const env = createEnv();
    const logged = await completeLogin(env);
    const own: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await handlePublishingRequest(
        req("/v1/my/counters", "POST", { design: clonePreset("pixel") },
          logged.accessToken), env, now + 1000 + i
      );
      expect(response.status).toBe(201);
      own.push((await response.json() as { slug:string }).slug);
    }
    expect((await handlePublishingRequest(
      req("/v1/my/counters", "POST", { design: clonePreset("pixel") },
        logged.accessToken), env, now + 2000
    )).status).toBe(409);
    const legacySlug = "v222222222222222222222222";
    env.DB.counters.set(legacySlug, {
      slug: legacySlug, owner: "guitar0788", owner_user_id: null,
      hits: 300, created_at: "2026-01-01T00:00:00Z",
      design_json: JSON.stringify(clonePreset("pixel"))
    });
    const target = "/v1/my/counters/" + legacySlug;
    expect((await handlePublishingRequest(req(target, "DELETE",
      { confirm: "DELETE", confirmSlug: legacySlug }, logged.accessToken),
      env, now + 3000)).status).toBe(404);
    expect(env.DB.counters.get(legacySlug)?.hits).toBe(300);

    env.DB.counters.set("v111111111111111111111111", {
      slug: "v111111111111111111111111", owner: "another",
      owner_user_id: 989898, hits: 50, created_at: "2026-01-01T00:00:00Z",
      design_json: JSON.stringify(clonePreset("minimal"))
    });
    expect((await handlePublishingRequest(req(
      "/v1/my/counters/v111111111111111111111111", "DELETE",
      { confirm: "DELETE", confirmSlug: "v111111111111111111111111" },
      logged.accessToken), env, now + 3001)).status).toBe(404);
    expect(env.DB.counters.get("v111111111111111111111111")?.hits).toBe(50);

    const slug = own[1];
    expect((await handlePublishingRequest(
      req("/v1/my/counters/" + slug, "GET", undefined, logged.accessToken),
      env, now + 3002
    )).status).toBe(405);
    const removed = await handlePublishingRequest(
      req("/v1/my/counters/" + slug, "DELETE",
        { confirm: "DELETE", confirmSlug: slug }, logged.accessToken),
      env, now + 3100
    );
    expect(removed.status).toBe(200);
    expect(env.DB.counters.has(own[0])).toBe(true);
    expect(env.DB.counters.has(own[2])).toBe(true);
    const replacement = await handlePublishingRequest(
      req("/v1/my/counters", "POST", { design: clonePreset("cyber") },
        logged.accessToken), env, now + 3200
    );
    expect(replacement.status).toBe(201);
    const newSlug = (await replacement.json() as {slug:string}).slug;
    expect(newSlug).not.toBe(slug);
    expect((await handlePublishingRequest(req("/v1/my/counters", "GET",
      undefined, logged.accessToken), env, now + 3300)).status).toBe(200);
    expect(env.DB.counters.size).toBe(5); // 3 owned + legacy + another user
  });

  it("does not assign legacy counters to matching GitHub usernames", async () => {
    const env = createEnv();
    env.DB.counters.set("legacy", {
      slug: "legacy", owner: "guitar0788", owner_user_id: null,
      design_json: JSON.stringify(clonePreset("pixel")), hits: 100, created_at: "2026-01-01"
    });
    const logged = await completeLogin(env);
    const list = await handlePublishingRequest(req("/v1/my/counters", "GET",
      undefined, logged.accessToken), env, now + 1000);
    expect((await list.json() as {counters:unknown[]}).counters).toEqual([]);
    expect((await handlePublishingRequest(req("/v1/my/counters/legacy/design", "PUT",
      { design: clonePreset("pixel") }, logged.accessToken), env, now + 2000)).status).toBe(404);
  });

  it("rejects invalid design and logout revokes a session", async () => {
    const env = createEnv();
    const logged = await completeLogin(env);
    expect((await handlePublishingRequest(req("/v1/my/counters", "POST",
      { design: { schemaVersion: 3, layers: [] } }, logged.accessToken),
      env, now + 1000)).status).toBe(400);
    expect((await handlePublishingRequest(req("/v1/auth/logout", "POST",
      undefined, logged.accessToken), env, now + 2000)).status).toBe(200);
    expect((await handlePublishingRequest(req("/v1/me", "GET",
      undefined, logged.accessToken), env, now + 3000)).status).toBe(401);
  });

  it("revokes previously issued sessions as soon as the numeric pilot allowlist changes", async () => {
    const env = createEnv();
    const logged = await completeLogin(env);
    const created = await handlePublishingRequest(
      req("/v1/my/counters", "POST", { design: clonePreset("pixel") },
        logged.accessToken), env, now + 2_000
    );
    expect(created.status).toBe(201);
    const { slug } = await created.json() as { slug: string };
    expect((await handlePublishingRequest(
      req("/v1/me", "GET", undefined, logged.accessToken),
      env, now + 3_000
    )).status).toBe(200);

    // Simulate emergency removal of the account, without changing D1 session
    // records. A still-unexpired token must immediately lose all permissions.
    env.PILOT_GITHUB_USER_ID = "999999";
    expect(publishingReady(env)).toBe(true);
    expect((await handlePublishingRequest(
      req("/v1/me", "GET", undefined, logged.accessToken),
      env, now + 3_100
    )).status).toBe(401);
    expect((await handlePublishingRequest(
      req("/v1/my/counters", "GET", undefined, logged.accessToken),
      env, now + 3_200
    )).status).toBe(401);
    expect((await handlePublishingRequest(
      req("/v1/my/counters/" + slug + "/design", "PUT",
        { design: clonePreset("cyber") }, logged.accessToken),
      env, now + 3_300
    )).status).toBe(401);
    expect(env.DB.counters.get(slug)?.owner_user_id).toBe(124379632);
    expect((await handlePublishingRequest(
      req("/v1/auth/exchange", "POST", { ticket: logged.ticket, verifier: logged.verifier }),
      env, now + 3_400
    )).status).toBe(401);
  });

  it("denies an unapproved GitHub numeric ID even when the login name matches", async () => {
    const env = createEnv();
    const verifier = "u".repeat(55);
    const challenge = await pkceChallenge(verifier);
    const begin = await handlePublishingRequest(
      req("/v1/auth/github/start", "POST", { challenge }), env, now);
    expect(begin.status).toBe(200);
    const data = await begin.json() as { state: string };
    const wrongIdentity: typeof fetch = async (url) =>
      String(url).includes("access_token")
        ? Response.json({ access_token: "gho_test_0123456789" })
        : Response.json({ id: 999999, login: "guitar0788" });
    const callback = await oauthCallback(new Request(apiOrigin +
      "v1/auth/github/callback?code=test-code&state=" + data.state),
      env, now + 1000, wrongIdentity);
    expect(callback.status).toBe(403);
    expect(env.DB.tickets.size).toBe(0);
    expect(env.DB.sessions.size).toBe(0);
  });

  it("rejects callback state replays", async () => {
    const env = createEnv();
    const verifier = "k".repeat(55);
    const state = await (await handlePublishingRequest(
      req("/v1/auth/github/start", "POST", { challenge: await pkceChallenge(verifier) }),
      env, now)).json() as {state:string};
    const callbackUrl = apiOrigin + "v1/auth/github/callback?code=code&state=" + state.state;
    expect((await oauthCallback(new Request(callbackUrl), env, now + 1, fakeGithub)).status).toBe(302);
    expect((await oauthCallback(new Request(callbackUrl), env, now + 2, fakeGithub)).status).toBe(401);
  });
});
