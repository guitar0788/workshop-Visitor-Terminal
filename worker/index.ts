import { handleRequest, pruneReceipts, type WorkerEnv } from "./service";

// Deploy only after connecting a real Cloudflare D1 database and setting both secrets.
export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
    await pruneReceipts(env);
  }
};
