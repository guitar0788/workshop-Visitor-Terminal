/**
 * Compile-time browser publishing gates.
 * Both publication and destructive account controls are disabled by default.
 * Keep the restricted staging host allowlist independent of test fixtures.
 */
export interface PublishBuildConfiguration {
  offlineDemoMode: boolean;
  publicApiOrigin: string;
  publishPilotMode: boolean;
  publishUiEnabled: boolean;
  accountDeletionUiEnabled: boolean;
}

/** Pure resolver: makes every safety gate testable without runtime bypasses. */
export function resolvePublishConfiguration(
  vars: Readonly<Record<string, string | undefined>>
): PublishBuildConfiguration {
  const offlineDemoMode = vars.VITE_OFFLINE_DEMO === "true";
  const configured = offlineDemoMode ? "" : vars.VITE_PUBLISH_API_ORIGIN?.trim() ?? "";
  const publicApiOrigin =
    /^https:\/\/workshop-visitor-terminal-staging\.[a-z0-9-]+\.workers\.dev\/?$/i.test(configured)
      ? configured.replace(/\/+$/, "") : "";
  const publishPilotMode = vars.VITE_PUBLISH_PILOT === "true";
  const publishUiEnabled =
    !offlineDemoMode && vars.VITE_PUBLISH_ENABLED === "true" &&
    publishPilotMode && publicApiOrigin.length > 0;
  const accountDeletionUiEnabled =
    publishUiEnabled && vars.VITE_ACCOUNT_DELETION_UI_ENABLED === "true";
  return {
    offlineDemoMode, publicApiOrigin, publishPilotMode,
    publishUiEnabled, accountDeletionUiEnabled
  };
}

const vars = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>
}).env ?? {};
const config = resolvePublishConfiguration(vars);

export const OFFLINE_DEMO_MODE = config.offlineDemoMode;
export const PUBLIC_API_ORIGIN = config.publicApiOrigin;
export const PUBLISH_PILOT_MODE = config.publishPilotMode;
export const PUBLISH_UI_ENABLED = config.publishUiEnabled;
export const ACCOUNT_DELETION_UI_ENABLED = config.accountDeletionUiEnabled;
