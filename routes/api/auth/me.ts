import { define } from "../../../utils.ts";
import { isAdminRequest } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";

export const handler = define.handlers({
  GET(ctx) {
    return json({ authenticated: isAdminRequest(ctx.req) });
  },
});
