import { define } from "../../../utils.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { PageParamError, parsePageParams } from "../../../lib/pagination.ts";
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
    try {
      return json(
        await listApiKeys(
          parsePageParams(ctx.req, ["siteId", "accountId"], "apiKeyQ"),
        ),
      );
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
      { accountId: number; name: string; key: string }
    >(ctx.req);
    const id = body ? await createApiKey(body) : null;
    return json({ id });
  },
});
