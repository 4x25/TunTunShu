import { define } from "../../../../utils.ts";
import { requireAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/response.ts";
import { routeId } from "../../../../lib/request.ts";
import { mintProxyToken } from "../../../../lib/proxy_session.ts";

// 签发绑定该账号的会话令牌,前端据此打开 /up/start?ticket=... 进入免登录代理会话。
export const handler = define.handlers({
  async POST(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    return json({ ticket: await mintProxyToken(routeId(ctx.params)) });
  },
});
