import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { readJson } from "../../../lib/request.ts";
import { fetchUsername } from "../../../services/account_service.ts";

// POST /api/accounts/probe-name { origin, userId, accessToken } → { name }
// 供前端「新建账号」时根据 origin 的 /api/user/self(data.username)自动补全账号名称。
export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<
      { origin?: string; userId?: string; accessToken?: string }
    >(ctx.req);
    const origin = body?.origin?.trim();
    const userId = body?.userId?.trim();
    const accessToken = body?.accessToken?.trim();
    if (!origin || !userId || !accessToken) return json({ name: null });
    return json({ name: await fetchUsername({ origin, userId, accessToken }) });
  },
});
