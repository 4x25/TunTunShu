import { define } from "../../../utils.ts";
import { getSql } from "../../../db/client.ts";
import { requireAdmin } from "../../../lib/auth.ts";
import { json } from "../../../lib/response.ts";
import { getCloakBrowserRuntimeStatus } from "../../../services/browser_checkin_service.ts";
import { getSettings } from "../../../services/settings_service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;

    const sql = getSql();
    const [lease] = await sql<{ busy: boolean }[]>`
      select exists (
        select 1 from browser_checkin_leases
        where name = 'global' and expires_at > now()
      ) as busy
    `;
    const settings = await getSettings();
    const enabled = settings.browser_checkin_enabled === "true";
    const timeoutSeconds = Number(settings.browser_checkin_timeout_seconds);

    try {
      const runtime = await getCloakBrowserRuntimeStatus();
      return json({
        enabled,
        timeoutSeconds,
        runtime: {
          available: runtime.available,
          wrapperVersion: runtime.wrapperVersion || null,
          chromiumVersion: runtime.chromiumVersion || null,
          error: runtime.available
            ? null
            : "CloakBrowser 运行时不可用，请查看服务端日志",
        },
        busy: lease?.busy ?? false,
      });
    } catch (error) {
      // 原始错误可能含二进制路径或许可证信息，只写服务端日志；管理 API 始终返回
      // 脱敏后的固定文案。
      console.error("cloakbrowser runtime status failed:", error);
      return json({
        enabled,
        timeoutSeconds,
        runtime: {
          available: false,
          wrapperVersion: null,
          chromiumVersion: null,
          error: "CloakBrowser 运行时不可用，请查看服务端日志",
        },
        busy: lease?.busy ?? false,
      });
    }
  },
});
