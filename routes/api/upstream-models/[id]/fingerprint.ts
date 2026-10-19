import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { routeId } from "../../../../lib/request.ts";
import { fingerprintUpstreamModel } from "../../../../services/upstream_model_fingerprint_service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    try {
      const result = await fingerprintUpstreamModel(routeId(ctx.params));
      if (!result) return json({ error: "未找到该上游模型" }, 404);
      return json(result);
    } catch (error) {
      // 不把内部路径/上游原始错误打印到客户端;细节只留在服务端日志。
      console.error(
        "fingerprint test failed:",
        error instanceof Error ? error.message : String(error),
      );
      return json({ error: "指纹验证失败，请稍后重试" }, 500);
    }
  },
});
