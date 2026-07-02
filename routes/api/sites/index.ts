import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { PageParamError, parsePageParams } from "../../../lib/pagination.ts";
import { json } from "../../../lib/response.ts";
import { createSite, listSites } from "../../../services/site_service.ts";
import { readJson } from "../../../lib/request.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    try {
      return json(await listSites(parsePageParams(ctx.req)));
    } catch (error) {
      if (error instanceof PageParamError) {
        return json({ error: error.message }, 400);
      }
      throw error;
    }
  },
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<
      { name?: string | null; origin: string; remark?: string | null }
    >(ctx.req);
    if (!body?.origin) return json({ error: "origin is required" }, 400);
    // upsert:命中已有 origin 即更新,统一回 200 + {success, id, updated}。
    const result = await createSite(body);
    return json({ success: true, id: result.id, updated: result.updated });
  },
});
