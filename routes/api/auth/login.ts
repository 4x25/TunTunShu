import { define } from "../../../utils.ts";
import { getAuthKey } from "../../../lib/env.ts";
import { json } from "../../../lib/response.ts";
import { readJson } from "../../../lib/request.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await readJson<{ authKey?: string }>(ctx.req);
    return json({ success: body?.authKey === getAuthKey() });
  },
});
