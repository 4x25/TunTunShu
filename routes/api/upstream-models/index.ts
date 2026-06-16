import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { listUpstreamModels } from "../../../services/upstream_model_service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await listUpstreamModels());
  },
});
