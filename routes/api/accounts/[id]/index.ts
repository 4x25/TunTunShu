import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import {
  deleteAccount,
  refreshAccount,
  updateAccount,
} from "../../../../services/account_service.ts";
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
    const id = routeId(ctx.params);
    const result = await updateAccount(id, await readJson(ctx.req) ?? {});
    // 后台刷新账号信息+额度、ApiKey、模型;best-effort,不阻塞响应。
    if (result) {
      void refreshAccount(id).catch((e) =>
        console.error("account refresh failed", id, e)
      );
    }
    return json(result);
  },
  async DELETE(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    await deleteAccount(routeId(ctx.params));
    return json({ success: true });
  },
});
