import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { syncAccount } from "../../../../services/account_service.ts";
import { routeId } from "../../../../lib/request.ts";

// POST /api/accounts/:id/sync → 手动执行单账号数据同步(与 cron 同一编排:
// 账号数据 ‖ 拉 Key,新增 Key 顺带拉模型)。前端账号行「检测」按钮调用。
export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await syncAccount(routeId(ctx.params)));
  },
});
