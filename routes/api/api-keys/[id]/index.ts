import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { deleteApiKey } from "../../../../services/api_key_service.ts";
import { routeId } from "../../../../lib/request.ts";

export const handler = define.handlers({
  GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json({ id: routeId(ctx.params) });
  },
  PATCH(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json({ id: routeId(ctx.params) });
  },
  async DELETE(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    await deleteApiKey(routeId(ctx.params));
    return json({ success: true });
  },
});
