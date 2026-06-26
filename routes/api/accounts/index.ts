import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import {
  createAccount,
  listAccounts,
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
    return json({ success: true, id: result.id, updated: result.updated });
  },
});
