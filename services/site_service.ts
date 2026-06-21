import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { getSql } from "../db/client.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";

const adapter = new NewApiAdapter();

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return m;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return m;
      }
    });
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** 请求 origin 首页并解析 HTML `<title>`;失败或无标题返回 null。 */
export async function fetchPageTitle(origin: string): Promise<string | null> {
  try {
    const res = await fetch(origin, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TunTunShu/1.0)" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return null;
    const title = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    return title || null;
  } catch {
    return null;
  }
}

export async function createSite(input: {
  name?: string | null;
  origin: string;
  remark?: string | null;
}) {
  const sql = getSql();
  // 站点名称非必填:留空时请求 origin 抓取网页 <title>,再退回域名。
  let name = (input.name ?? "").trim();
  if (!name) {
    name = (await fetchPageTitle(input.origin)) ?? hostOf(input.origin);
  }
  const rows = await sql<{ id: number }[]>`
    insert into sites (name, origin, remark)
    values (${name}, ${input.origin}, ${input.remark ?? null})
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function listSites() {
  const sql = getSql();
  return await sql`select * from sites order by id desc`;
}

export async function updateSite(
  id: number,
  input: {
    name?: string;
    origin?: string;
    enabled?: boolean;
    remark?: string | null;
  },
) {
  const sql = getSql();
  const current = await sql<
    { name: string; origin: string; enabled: boolean; remark: string | null }[]
  >`select name, origin, enabled, remark from sites where id = ${id}`;
  if (!current[0]) return null;
  const name = input.name ?? current[0].name;
  const origin = input.origin ?? current[0].origin;
  const enabled = input.enabled ?? current[0].enabled;
  const remark = input.remark !== undefined ? input.remark : current[0].remark;
  await sql`
    update sites
    set name = ${name}, origin = ${origin}, enabled = ${enabled}, remark = ${remark}, updated_at = now()
    where id = ${id}
  `;
  return { id, name, origin, enabled, remark };
}

export async function healthCheckSite(id: number) {
  const sql = getSql();
  const rows = await sql<{ id: number; origin: string }[]>`
    select id, origin from sites where id = ${id}
  `;
  const site = rows[0];
  if (!site) return null;
  try {
    const response = await adapter.healthCheck(site.origin);
    const healthy = response.status !== 404 && response.status < 500;
    const status = healthy ? "healthy" : "down";
    const logId = await createSystemTaskLog({
      taskType: "site_health_check",
      status: healthy ? "success" : "failed",
      siteId: id,
      message: `http_status=${response.status}`,
    });
    await sql`
      update sites
      set status = ${status}, last_health_check_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok: healthy, httpStatus: response.status, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logId = await createSystemTaskLog({
      taskType: "site_health_check",
      status: "failed",
      siteId: id,
      message,
    });
    await sql`
      update sites
      set status = 'down', last_health_check_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok: false, error: message, status: "down" };
  }
}

export async function deleteSite(id: number) {
  const sql = getSql();
  const accounts = await sql<
    { id: number }[]
  >`select id from accounts where site_id = ${id}`;
  for (const account of accounts) {
    const apiKeys = await sql<
      { id: number }[]
    >`select id from api_keys where account_id = ${account.id}`;
    for (const apiKey of apiKeys) {
      await sql`delete from upstream_models where api_key_id = ${apiKey.id}`;
    }
    await sql`delete from api_keys where account_id = ${account.id}`;
  }
  await sql`delete from accounts where site_id = ${id}`;
  await sql`delete from sites where id = ${id}`;
}
