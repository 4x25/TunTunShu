import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { syncAccountApiKeys } from "../../../../services/account_service.ts";
import { routeId } from "../../../../lib/request.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await syncAccountApiKeys(routeId(ctx.params)));
  },
});
