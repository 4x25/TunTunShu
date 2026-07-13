import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { PageParamError, parsePageParams } from "../../../lib/pagination.ts";
import { json } from "../../../lib/response.ts";
import { listUpstreamModels } from "../../../services/upstream_model_service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    try {
      return json(
        await listUpstreamModels(
          parsePageParams(
            ctx.req,
            ["siteId", "accountId", "apiKeyId"],
            "modelQ",
          ),
        ),
      );
    } catch (error) {
      if (error instanceof PageParamError) {
        return json({ error: error.message }, 400);
      }
      throw error;
    }
  },
});
