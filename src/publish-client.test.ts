import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBLISH_UI_ENABLED, deletePublishedCounter, markdownEmbed, readOAuthReturn,
  verifyPublishedAccountExport
} from "./publish-client";

afterEach(() => vi.unstubAllGlobals());

describe("v0.5 browser publishing safety", () => {
  it("remains disabled on an unconfigured public GitHub Pages build", () => {
    expect(PUBLISH_UI_ENABLED).toBe(false);
  });
  it("refuses arbitrary images as published README embed links", () => {
    expect(() => markdownEmbed("https://malicious.example/counter.svg")).toThrow();
    expect(() => markdownEmbed("javascript:alert(1)")).toThrow();
  });
  it("refuses invalid deletion IDs before any browser request", async () => {
    for (const invalid of ["", "legacy", "v123", "v" + "g".repeat(24),
      "v" + "a".repeat(24) + "/design", "../admin"]) {
      await expect(deletePublishedCounter("session", invalid))
        .rejects.toThrow("Invalid counter identifier");
    }
  });
  it("accepts only a signed-in account's genuine v1 export and exact SVG origin", () => {
    const user = { id: 124379632, login: "guitar0788" };
    const origin = "https://workshop-visitor-terminal-staging.example.workers.dev";
    const slug = "v" + "a".repeat(24);
    const payload = {
      formatVersion: 1, exportedAt: "2026-11-01T00:00:00.000Z",
      account: { githubId: user.id, githubLogin: user.login },
      maxCounters: 3, counters: [{
        slug, hits: 20, createdAt: "2026-11-01T00:00:00.000Z",
        imageUrl: origin + "/v1/counters/" + slug + ".svg",
        design: { schemaVersion: 1, layers: [] }
      }]
    };
    expect(verifyPublishedAccountExport(payload, user, origin)).toEqual(payload);
    const bad = [
      { ...payload, formatVersion: 9 },
      { ...payload, account: {githubId:9,githubLogin:user.login} },
      { ...payload, account: {githubId:user.id,githubLogin:"stranger"} },
      { ...payload, counters: payload.counters.concat(payload.counters,
        payload.counters, payload.counters) },
      { ...payload, counters: [{...payload.counters[0],
        imageUrl: "https://malicious.example/v1/counters/" + slug + ".svg"}] },
      { ...payload, counters: [{...payload.counters[0],
        imageUrl: origin + "/v1/counters/" + slug + ".svg?token=x"}] },
      { ...payload, counters: [{...payload.counters[0],slug:"../unsafe"}] },
      { ...payload, counters: [{...payload.counters[0],design:{schemaVersion:99}}] }
    ];
    for (const candidate of bad) {
      expect(() => verifyPublishedAccountExport(candidate, user, origin))
        .toThrow("Unexpected account export response");
    }
  });
  it("removes one-use OAuth ticket and state from URL before exchanging them", () => {
    const ticket = "a".repeat(64), state = "b".repeat(64);
    const replaced: string[] = [];
    const page = "https://guitar0788.github.io/workshop-Visitor-Terminal/?auth_ticket=" +
      ticket + "&auth_state=" + state + "#editor";
    vi.stubGlobal("window", {
      location: { href: page },
      history: {
        state: null,
        replaceState: (_unused: unknown, _title: string, path: string) => {
          replaced.push(path);
        }
      }
    });
    expect(readOAuthReturn()).toEqual({ ticket, state });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).not.toContain(ticket);
    expect(replaced[0]).not.toContain("auth_state");
    expect(replaced[0]).toContain("#editor");
  });
  it("discards malformed login callback parameters without retaining a URL ticket", () => {
    const replaced: string[] = [];
    vi.stubGlobal("window", {
      location: {
        href: "https://guitar0788.github.io/workshop-Visitor-Terminal/?auth_ticket=bad&auth_state=invalid"
      },
      history: {
        state: null,
        replaceState: (_unused: unknown, _title: string, path: string) => replaced.push(path)
      }
    });
    expect(() => readOAuthReturn()).toThrow("Invalid sign-in return");
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).not.toContain("auth_ticket");
  });
});
