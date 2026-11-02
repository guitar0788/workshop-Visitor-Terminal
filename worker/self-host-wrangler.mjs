/**
 * Invoke the exact npm-locked Wrangler binary through Node on every OS.
 * Running .cmd via child_process.spawn/execFile is unreliable on Windows and
 * shell:true would introduce argument interpretation or quoting hazards.
 *
 * Only the caller supplies trusted fixed subcommand/flags; this helper does
 * not run a shell, npx, git, remote deploy or network operations by itself.
 */
import { join } from "node:path";

export function wranglerInvocation(root, args) {
  if (typeof root !== "string" || !root || !Array.isArray(args) ||
      args.some(value => typeof value !== "string" || value.includes("\u0000"))) {
    throw Error("Invalid local Wrangler invocation");
  }
  return {
    executable: process.execPath,
    args: [join(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...args]
  };
}
