import { App, staticFiles } from "fresh";
import { define, type State } from "./utils.ts";
import { initializeDatabase } from "./db/init.ts";
import { getSettings } from "./services/settings_service.ts";
import { runAccountCheckinJob } from "./jobs/account_checkin_job.ts";
import { runAccountQuotaSyncJob } from "./jobs/account_quota_sync_job.ts";
import { runApiKeyModelSyncJob } from "./jobs/api_key_model_sync_job.ts";
import { runRequestLogCleanupJob } from "./jobs/request_log_cleanup_job.ts";
import { runSiteHealthCheckJob } from "./jobs/site_health_check_job.ts";

export const app = new App<State>();

app.use(staticFiles());
app.use(define.middleware((ctx) => ctx.next()));

await initializeDatabase();

// 定时任务:Deno.cron 需 deno.json 的 unstable:["cron"];调度时间按 UTC 解释。
// 必须在 server 启动前于模块顶层注册;schedule 取自启动时的设置,改设置需重启生效。
if (typeof Deno.cron === "function") {
  try {
    const settings = await getSettings();
    Deno.cron("account_checkin", settings.cron_account_checkin, async () => {
      try {
        await runAccountCheckinJob();
      } catch (error) {
        console.error("cron account_checkin failed:", error);
      }
    });
    Deno.cron(
      "account_quota_sync",
      settings.cron_account_quota_sync,
      async () => {
        try {
          await runAccountQuotaSyncJob();
        } catch (error) {
          console.error("cron account_quota_sync failed:", error);
        }
      },
    );
    Deno.cron(
      "site_health_check",
      settings.cron_site_health_check,
      async () => {
        try {
          await runSiteHealthCheckJob();
        } catch (error) {
          console.error("cron site_health_check failed:", error);
        }
      },
    );
    Deno.cron("api_key_model_sync", settings.cron_model_sync, async () => {
      try {
        await runApiKeyModelSyncJob();
      } catch (error) {
        console.error("cron api_key_model_sync failed:", error);
      }
    });
    Deno.cron(
      "request_log_cleanup",
      settings.cron_request_log_cleanup,
      async () => {
        try {
          await runRequestLogCleanupJob();
        } catch (error) {
          console.error("cron request_log_cleanup failed:", error);
        }
      },
    );
  } catch (error) {
    console.warn("Deno.cron 注册失败:", error);
  }
}

app.fsRoutes();
