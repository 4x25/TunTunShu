import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import {
  createApiKey,
  listApiKeys,
} from "../../../services/api_key_service.ts";
import { readJson } from "../../../lib/request.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json(await listApiKeys());
  },
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<
      { accountId: number; name: string; key: string }
    >(ctx.req);
    const id = body ? await createApiKey(body) : null;
    return json({ id });
  },
});
