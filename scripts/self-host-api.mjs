/**
 * Resolve a user-confirmed public Worker origin without Cloudflare discovery.
 *
 * Explicit --api remains backward compatible for local Wrangler tests. The
 * convenience WVT_API_URL fallback accepts only an HTTPS *.workers.dev host:
 * never a custom domain, localhost, redirect, path or credential-bearing URL.
 * Individual callers MUST still check the hostname against the user's private
 * self-host configuration before reading or sending a bearer token.
 */
export function resolveSelfHostApi(explicitApi, environment = process.env) {
  if (explicitApi !== undefined && explicitApi !== null) {
    if (typeof explicitApi !== "string" || !explicitApi) {
      throw Error("Invalid explicit --api Worker origin");
    }
    return explicitApi;
  }
  const provided = environment?.WVT_API_URL;
  if (typeof provided !== "string" || !provided ||
      provided.trim() !== provided) {
    throw Error("Provide --api or set WVT_API_URL to your own HTTPS workers.dev Worker");
  }
  let url;
  try { url = new URL(provided); }
  catch { throw Error("WVT_API_URL must be a valid HTTPS workers.dev origin"); }
  const parts = url.hostname.split(".");
  if (url.protocol !== "https:" ||
      parts.length !== 4 || parts[2] !== "workers" || parts[3] !== "dev" ||
      !parts.slice(0, 2).every(x => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x)) ||
      !parts.slice(0, 2).every(x => !x.includes("--")) ||
      url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash ||
      !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/.test(provided)) {
    throw Error("WVT_API_URL must be the exact HTTPS root of your own workers.dev Worker");
  }
  return url.origin;
}
