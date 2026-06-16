import { define } from "../../utils.ts";
import { json } from "../../lib/response.ts";
import { requireAdmin } from "../../lib/auth.ts";
import {
  clearRequestLogs,
  listRequestLogs,
} from "../../services/request_log_service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await listRequestLogs());
  },
  async DELETE(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    await clearRequestLogs();
    return json({ success: true });
  },
});
