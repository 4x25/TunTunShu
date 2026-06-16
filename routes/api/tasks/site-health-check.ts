import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { runSiteHealthCheckJob } from "../../../jobs/site_health_check_job.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await runSiteHealthCheckJob());
  },
});
