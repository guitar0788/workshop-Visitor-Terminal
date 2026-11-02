import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_UI_ENABLED, PUBLISH_UI_ENABLED,
  resolvePublishConfiguration
} from "./publish-config";

const APPROVED_ORIGIN =
  "https://workshop-visitor-terminal-staging.test.workers.dev";
const enabled = {
  VITE_PUBLISH_ENABLED: "true",
  VITE_PUBLISH_PILOT: "true",
  VITE_PUBLISH_API_ORIGIN: APPROVED_ORIGIN,
  VITE_ACCOUNT_DELETION_UI_ENABLED: "true"
};

describe("immutable publication and account deletion build gates", () => {
  it("defaults to disabled without credentials or a reviewed build", () => {
    expect(resolvePublishConfiguration({})).toMatchObject({
      publicApiOrigin: "", publishUiEnabled: false,
      accountDeletionUiEnabled: false
    });
    expect(PUBLISH_UI_ENABLED).toBe(false);
    expect(ACCOUNT_DELETION_UI_ENABLED).toBe(false);
  });

  it("requires every publishing flag and the exact staging host family", () => {
    expect(resolvePublishConfiguration(enabled)).toMatchObject({
      publicApiOrigin: APPROVED_ORIGIN,
      publishPilotMode: true, publishUiEnabled: true,
      accountDeletionUiEnabled: true
    });
    const rejected = [
      { ...enabled, VITE_PUBLISH_ENABLED: "false" },
      { ...enabled, VITE_PUBLISH_PILOT: "false" },
      { ...enabled, VITE_PUBLISH_API_ORIGIN: "http://workshop-visitor-terminal-staging.test.workers.dev" },
      { ...enabled, VITE_PUBLISH_API_ORIGIN: "https://evil.workers.dev" },
      { ...enabled, VITE_PUBLISH_API_ORIGIN: "https://workshop-visitor-terminal-staging.test.workers.dev.evil.example" },
      { ...enabled, VITE_OFFLINE_DEMO: "true" }
    ];
    for (const candidate of rejected) {
      expect(resolvePublishConfiguration(candidate).publishUiEnabled).toBe(false);
      expect(resolvePublishConfiguration(candidate).accountDeletionUiEnabled).toBe(false);
    }
  });

  it("never enables account deletion from publishing alone", () => {
    for (const flag of [undefined, "false", "TRUE", "", "1"]) {
      expect(resolvePublishConfiguration({
        ...enabled, VITE_ACCOUNT_DELETION_UI_ENABLED: flag
      })).toMatchObject({
        publishUiEnabled: true, accountDeletionUiEnabled: false
      });
    }
    expect(resolvePublishConfiguration({
      ...enabled, VITE_ACCOUNT_DELETION_UI_ENABLED: "true"
    }).accountDeletionUiEnabled).toBe(true);
  });
});
