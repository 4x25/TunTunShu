import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { runApiKeyModelSyncJob } from "../../../jobs/api_key_model_sync_job.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await runApiKeyModelSyncJob());
  },
});
