import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { readJson } from "../../../lib/request.ts";
import { fetchPageTitle } from "../../../services/site_service.ts";

// POST /api/sites/probe-title { origin } → { title }
// 供前端「新建站点」时根据 origin 自动补全站点名称(网页 <title>)。
export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<{ origin?: string }>(ctx.req);
    const origin = body?.origin?.trim();
    if (!origin) return json({ title: null });
    return json({ title: await fetchPageTitle(origin) });
  },
});
