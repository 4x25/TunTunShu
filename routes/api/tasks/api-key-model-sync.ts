import { define } from "../../../utils.ts";
import { getSql } from "../../../db/client.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { syncApiKeyModels } from "../../../services/api_key_service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const sql = getSql();
    const rows = await sql<
      { id: number }[]
    >`select id from api_keys order by id`;
    const results = [];
    for (const row of rows) {
      results.push({ id: row.id, result: await syncApiKeyModels(row.id) });
    }
    return json({ count: results.length, results });
  },
});
