import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { readJson, routeId } from "../../../../lib/request.ts";
import {
  type TestKind,
  testUpstreamModel,
} from "../../../../services/upstream_model_test_service.ts";

const KINDS: TestKind[] = ["chat", "vision", "tool"];

export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const body = await readJson<{ kind?: string }>(ctx.req);
    const kind = KINDS.includes(body?.kind as TestKind)
      ? body!.kind as TestKind
      : "chat";
    return json(await testUpstreamModel(routeId(ctx.params), kind));
  },
});
