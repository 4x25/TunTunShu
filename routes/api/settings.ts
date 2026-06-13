import { define } from "../../utils.ts";
import { json } from "../../lib/response.ts";
import { requireAdmin } from "../../lib/auth.ts";
import {
  getSettings,
  updateSettings,
} from "../../services/settings_service.ts";
import { readJson } from "../../lib/request.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await getSettings());
  },
  async PATCH(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<Record<string, string>>(ctx.req);
    return json(await updateSettings(body ?? {}));
  },
});
