import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { notImplemented } from "../../../lib/response.ts";

export const handler = define.handlers({
  POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return notImplemented();
  },
});
