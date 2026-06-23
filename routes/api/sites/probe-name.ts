import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { readJson } from "../../../lib/request.ts";
import { fetchSystemName } from "../../../services/site_service.ts";

// POST /api/sites/probe-name { origin } → { name }
// 供前端「新建站点」时根据 origin 的 /api/status(data.system_name)自动补全站点名称。
export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<{ origin?: string }>(ctx.req);
    const origin = body?.origin?.trim();
    if (!origin) return json({ name: null });
    return json({ name: await fetchSystemName(origin) });
  },
});
