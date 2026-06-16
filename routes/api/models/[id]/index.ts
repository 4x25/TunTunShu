import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import {
  deleteModel,
  updateModel,
} from "../../../../services/model_service.ts";
import { readJson, routeId } from "../../../../lib/request.ts";

export const handler = define.handlers({
  GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json({ id: routeId(ctx.params) });
  },
  async PATCH(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(
      await updateModel(routeId(ctx.params), await readJson(ctx.req) ?? {}),
    );
  },
  async DELETE(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    await deleteModel(routeId(ctx.params));
    return json({ success: true });
  },
});
