import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import {
  createAccount,
  listAccounts,
  refreshAccount,
} from "../../../services/account_service.ts";
import { readJson } from "../../../lib/request.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await listAccounts());
  },
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<
      {
        siteId: number;
        name?: string | null;
        userId: string;
        accessToken: string;
      }
    >(ctx.req);
    if (!body?.siteId || !body?.userId || !body?.accessToken) {
      return json({ error: "siteId、userId、accessToken 不能为空" }, 400);
    }
    // upsert:命中已有 (siteId, userId) 即更新,统一回 200 + {success, id, updated}。
    const result = await createAccount(body);
    // 后台刷新账号信息+额度、ApiKey、模型;best-effort,不阻塞响应。
    void refreshAccount(result.id).catch((e) =>
      console.error("account refresh failed", result.id, e)
    );
    return json({ success: true, id: result.id, updated: result.updated });
  },
});
