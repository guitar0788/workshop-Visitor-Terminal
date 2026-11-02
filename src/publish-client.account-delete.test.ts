import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function enableDeletionBuild() {
  vi.stubEnv("VITE_PUBLISH_API_ORIGIN",
    "https://workshop-visitor-terminal-staging.test.workers.dev");
  vi.stubEnv("VITE_PUBLISH_ENABLED", "true");
  vi.stubEnv("VITE_PUBLISH_PILOT", "true");
  vi.stubEnv("VITE_ACCOUNT_DELETION_UI_ENABLED", "true");
  vi.stubEnv("VITE_OFFLINE_DEMO", "false");
}

describe("separately gated account deletion client", () => {
  it("sends only the exact DELETE confirmation after both build gates are enabled", async () => {
    enableDeletionBuild();
    const client = await import("./publish-client");
    expect(client.PUBLISH_UI_ENABLED).toBe(true);
    expect(client.ACCOUNT_DELETION_UI_ENABLED).toBe(true);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      deleted: true, signedOutEverywhere: true, deletedCounters: 2
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await client.deletePublishedAccount("a".repeat(64), "guitar0788");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(
      "https://workshop-visitor-terminal-staging.test.workers.dev/v1/my/account"
    );
    expect(call[1].method).toBe("DELETE");
    expect(JSON.parse(String(call[1].body))).toEqual({
      confirm: "DELETE_MY_ACCOUNT", confirmLogin: "guitar0788"
    });
    expect((call[1].headers as Record<string, string>).Authorization)
      .toBe("Bearer " + "a".repeat(64));
  });

  it("rejects invalid GitHub logins before making a request", async () => {
    enableDeletionBuild();
    const client = await import("./publish-client");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const invalid of ["", "bad login", "-starts-with-dash", "ends-with-dash-",
      "x".repeat(40), "login/name"]) {
      await expect(client.deletePublishedAccount("a".repeat(64), invalid))
        .rejects.toThrow("Invalid GitHub login");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat a disabled server endpoint as a successful deletion", async () => {
    enableDeletionBuild();
    const client = await import("./publish-client");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    )));
    await expect(client.deletePublishedAccount("a".repeat(64), "guitar0788"))
      .rejects.toThrow("Not found");
  });
});
