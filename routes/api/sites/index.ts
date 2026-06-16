import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { createSite, listSites } from "../../../services/site_service.ts";
import { readJson } from "../../../lib/request.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await listSites());
  },
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<
      { name: string; origin: string; remark?: string | null }
    >(ctx.req);
    const id = body ? await createSite(body) : null;
    return json({ id });
  },
});
