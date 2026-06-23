import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { readJson, routeId } from "../../../../lib/request.ts";
import { probeAccountUsername } from "../../../../services/account_service.ts";

// POST /api/accounts/:id/probe-name { userId?, accessToken? } → { name }
// 编辑账号时自动补全用户名:userId/accessToken 留空则用库里已存的凭据。
export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<{ userId?: string; accessToken?: string }>(
      ctx.req,
    );
    const name = await probeAccountUsername(routeId(ctx.params), body ?? {});
    return json({ name });
  },
});
