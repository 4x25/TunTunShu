# AGENTS.md — TunTunShu (囤囤鼠)

> **本文件是本仓库的唯一事实来源(single source of truth)。** `CLAUDE.md`
> 只是指向这里。改动行为时请同步更新本文件。

## Overview

TunTunShu 是一个**单用户的多上游 AI 聚合 / 中转代理**,自带后台管理
UI。它管理一棵 new-api 资源树(站点 Site → 账号 Account → API Key → 上游模型
UpstreamModel),对外暴露 **OpenAI 兼容的 `/v1/*`
代理**:客户端请求一个逻辑模型名,服务在所有健康的上游候选里随机选一个
(可选重试)转发并记录 token 用量。后台 `Deno.cron`
负责签到、额度/模型同步、站点健康检查、日志清理。

**单一身份模型**:一个 `AUTH_KEY` 同时是后台登录口令、浏览器侧 localStorage
Bearer(`tts-auth`)、 `/api/*` 管理令牌,以及恒定有效的 `/v1` 代理 Key。

## Stack

- **Runtime**: Deno;Fresh 2(`jsr:@fresh/core`)文件路由。
- **Frontend**: Preact + `@preact/signals` islands + Tailwind CSS 4 +
  DaisyUI,Vite 构建。Fresh 在服务端渲染 HTML 外壳 + Layout + island
  初始标记,islands 在浏览器 hydrate; **页面 handler
  不做任何服务端取数**,所有数据在浏览器侧请求 `/api/*`。(并非 “CSR-only”——外壳是
  SSR 的。)
- **Database**: PostgreSQL,经 `npm:postgres` 原始驱动。**无 ORM、无 migration
  框架**。
- **AI SDK(仅服务端)**:
  `ai`、`@ai-sdk/openai|anthropic|google`,**仅**被上游模型测试功能
  (`services/upstream_model_test_service.ts`)使用,与代理无关。必须在
  `vite.config.ts` 里保持 external(见 Gotchas)。
- **不使用**: DrizzleORM、Prisma、Hono、React、ShadcnUI。

## Commands

```bash
deno task check    # deno fmt --check . && deno lint . && deno check  (注意:deno check 无路径参数)
deno task dev      # vite(HMR 开发服务器)
deno task build    # vite build → _fresh/
deno task start    # deno serve -A _fresh/server.js(生产)
deno task update   # deno run -A -r jsr:@fresh/update .
deno test -A       # 全部自动化测试
```

`deno fmt`(不带 `--check`)自动修复格式。

**改完代码的校验流程**(收尾必走):`deno install`(补齐 node_modules——本仓
`nodeModulesDir: "manual"`,缺包会让 `deno check` 失败)→ `deno task check`(fmt
--check + lint + check,静态校验)→ `deno task dev`(确保 Vite 构建无误)。

项目级 Stop hook(`.claude/settings.json` →
`.claude/hooks/deno-check.sh`)会在「改过 `.ts`/`.tsx` 的回复结束时」自动跑
`deno task check`,失败即把输出反馈回来;纯问答/纯文档 轮次跳过。它不替代上面的
`deno install` 与 `deno task dev`。

**PR 后必做 code review**:创建 PR 后,**派一个干净上下文的子代理**对改动做 code
review——子代理不偏袒作者写的代码,能更中立地挑出问题;再据其反馈修订。

## Deploy

已部署到 **Deno Deploy**:**推送代码到仓库即自动触发构建 + 预览**,无需手动部署。
推送前先在本地跑通上面的校验三步。

## CI

GitHub Actions(`.github/workflows/ci.yml`)在 push / PR 到 `master` 时,在
ubuntu-latest 上跑四步:`deno install`(补齐
node_modules——`nodeModulesDir:
"manual"` 必须先装,否则 `deno check` 因缺包失败)→
`deno task check`(fmt --check + lint + check 静态校验)→ `deno test -A`(测试)→
`deno task build`(vite build,验证生产构建——已实测不连数据库,无需任何
env)。权限收敛为 `contents:
read`。CI 只做质量门禁,**不负责部署**——部署仍由 Deno
Deploy 在推送时自动完成。

## Environment

| Env            | 必填 | 默认            | 说明                                                             |
| -------------- | ---- | --------------- | ---------------------------------------------------------------- |
| `AUTH_KEY`     | 是   | —               | 管理登录口令 + 默认代理 Key;**首次调用 getAuthKey() 时**才抛错   |
| `DATABASE_DSN` | 是   | —               | PostgreSQL DSN;缺失时**启动即抛错**(initializeDatabase → getSql) |
| `HOST`         | 否   | `0.0.0.0`       | 监听地址                                                         |
| `PORT`         | 否   | `4025`          | 监听端口                                                         |
| `TZ`           | 否   | `Asia/Shanghai` | 时区;**不影响 cron**——Deno.cron 一律按 UTC 解释                  |

## Entrypoint & Startup(main.ts)

启动顺序:`app.use(staticFiles())` → 中间件服务 `GET /tuntunshu.user.js`(无鉴权)→
`await initializeDatabase()` → `if (typeof Deno.cron === "function")` 注册 5 个
cron 任务(schedule 在此处经 `getSettings()` **一次性**读取,每个任务体各自
try/catch)→ `app.fsRoutes()`。main.ts 里没有显式 `Deno.serve`——服务由
`deno serve _fresh/server.js` (生产)或 `vite`(开发)启动。

## Directory map

```
routes/
  *.tsx          页面路由(index/login/upstream/models/logs/settings),各渲染一个 island;_app.tsx 是 HTML 外壳 + 防闪烁主题引导脚本
  api/*          后台 API —— 每个 handler 首行 requireAdmin(ctx.req)(例外见下)
  v1/*           OpenAI 兼容代理 —— 各自内联实现代理 Key 校验
islands/         Preact islands(Dashboard/Upstream/Models/Logs/Settings/LoginCard/ThemeToggle)
components/      Layout、Modal、admin_api.ts(浏览器 API 客户端)、icons、brand_icons、use_url_state
services/        业务逻辑(被 routes 调用),各自写 system_task_logs
adapters/new_api_adapter.ts   对上游 new-api HTTP 的薄 fetch 封装
db/client.ts     postgres 单例 getSql()(max:5, idle_timeout:20, connect_timeout:10;池被 cron 与 HTTP 共用)
db/init.ts       启动时建表(见 Database)
jobs/            5 个 cron 任务函数 + runner.ts(串行批处理器)
lib/             auth、env、config(defaultSettings)、mask、request、response、sse、userscript、test_images
types/           enums.ts(状态字面量联合)、models.ts(camelCase 服务端接口,islands 并不引用)、openai.ts
```

## Auth boundaries

- **`/api/*`**: `requireAdmin()`(lib/auth.ts)比对 `Bearer` 是否等于
  `AUTH_KEY`。401 响应体 `{"error":"Unauthorized"}`。**无鉴权例外**:仅
  `POST /api/auth/login`。
- **`/v1/*`**: 有效 Key =
  `Set([AUTH_KEY, ...proxy_auth_keys 按换行拆分])`。该校验在
  `routes/v1/chat/completions.ts` 与 `routes/v1/models.ts`
  中**各自内联实现**(不在 lib/auth.ts)。 401 为 OpenAI 风格
  `{error:{message,type,code:'invalid_api_key',param}}`。

两种 401 形状是有意为之。

## HTTP route surface

### `/v1`(代理 Key 鉴权)

- `POST /v1/chat/completions`
- `GET /v1/models`

### `/api`(管理鉴权,除标注外)

- **auth**: `POST /api/auth/login`(开放)
- **dashboard**: `GET /api/dashboard`
- **sites**:
  `GET|POST /api/sites`;`GET|PATCH|DELETE /api/sites/:id`;`POST /api/sites/:id/health-check`;`POST /api/sites/probe-name`
- **accounts**:
  `GET|POST /api/accounts`;`GET|PATCH|DELETE /api/accounts/:id`;`POST /api/accounts/:id/{checkin,sync-api-keys,sync-quota,probe-name}`;`POST /api/accounts/probe-name`
- **api-keys**:
  `GET|POST /api/api-keys`;`GET|PATCH|DELETE /api/api-keys/:id`;`POST /api/api-keys/:id/sync-models`
- **models**: `GET|POST /api/models`;`GET|PATCH|DELETE /api/models/:id`
- **upstream-models**:
  `GET /api/upstream-models`;`GET|PATCH /api/upstream-models/:id`(PATCH 接受
  `modelId:null`
  解除映射、`endpointType`);`POST /api/upstream-models/:id/test`;`POST /api/upstream-models/batch-link`
  与 `batch-unlink`(**两者都返回 501 notImplemented**)。**无 create POST、无
  DELETE**——上游模型由同步任务创建。
- **settings**: `GET|PATCH /api/settings`
- **logs**:
  `GET /api/request-logs`;`DELETE /api/request-logs`;`GET /api/system-task-logs`
- **tasks**(全部 POST):
  `/api/tasks/{account-checkin, account-quota-sync, api-key-model-sync, site-health-check, request-log-cleanup, account-api-key-sync}`

各资源的 `GET /:id` 是占位实现,只返回 `{id}`。

`POST /api/sites`(按 origin)与 `POST /api/accounts`(按 site_id,user_id)是**幂等
upsert**:命中唯一键即就地更新,恒回 200 `{success,id,updated}`,**从不返回 409**——
故后台「新建」一个已存在的
origin/账号会**静默更新而非报错**(为让油猴脚本「录入」与 「重存」走同一条
POST)。

## OpenAI-compatible proxy core(routes/v1/chat/completions.ts)

路由逻辑在 route handler 里,**不在 `proxy_service.ts`(那是死代码空壳)**。

1. **可路由候选**:5 表 inner join
   `models → upstream_models → api_keys → accounts → sites`, 过滤“全链路 enabled
   且 status ≠ 'invalid'”(站点用 status ≠ 'down')。`GET /v1/models`
   用同一过滤(去掉模型名条件)。
2. **随机打散**(`sort(() => Math.random() - 0.5)`),attempts =
   `candidates.slice(0, min(len, channel_retry_count+1))`。 默认
   `channel_retry_count=0` ⇒ **默认只尝试一次,不重试**。
3. **超时仅约束响应头到达前**:每次尝试用 AbortController +
   `upstream_header_timeout_seconds`(默认 60s)
   超时;响应头一到即清除定时器,故**流式 body 的生成时长不受限**。
4. **include_usage**:流式请求且未设 `stream_options` 时注入
   `stream_options.include_usage=true`; 并把 model 改写为上游名。
5. **流式成功**:经
   `createUsageSniffingStream`(lib/sse.ts)原样转发分片并嗅探最后一个 usage;
   request_logs 为 fire-and-forget(绝不阻塞流)。**非流式**:解析 usage、**await**
   写日志、透传上游状态码。
6. **错误**:每次尝试(成功/失败)都写一条 request_logs(非末次
   request_type='retry',末次/已提交='final')。 全部失败时,若任一上游返回过 HTTP
   响应,则**透传上游真实 body/状态码/Content-Type**(保留 403/quota
   语义);仅当从未拿到任何 HTTP 响应才回合成的 openaiError 502。另:缺 model 回
   400,无候选回 404 model_not_found。
7. 日志中 Key 经 `maskKey` 脱敏(`first4...last4`,长度 ≤8 时 `first1...last1`)。

`GET /v1/models` 返回
`{object:'list', data:[{id:name, object:'model', created:0, owned_by:'tuntunshu'}]}`,
按 `models.id desc`。

**代理类设置**(channel_retry_count、upstream_header_timeout_seconds、proxy_auth_keys)在**每次请求时**
从 system_settings 读取 ⇒ **立即生效**(与 cron 设置需重启相反)。

## new-api upstream adapter(adapters/new_api_adapter.ts)

> **上游参考(关键)**:本项目是 new-api 聚合站,凡涉及上游行为(签到 / token /
> 额度、`body.success` 成败约定、鉴权失败也回 HTTP 200、`expired_time: -1`、
> quota 换算等)一律以 **new-api 源码**为准,不要凭猜。仓库
> <https://github.com/QuantumNous/new-api>,本地
> `~/OpenSource/new-api`——**读代码前先
> `git -C ~/OpenSource/new-api pull`**(本地若无则 clone)。

薄 fetch 封装,每个方法返回原始 Response。**这里描述的是本应用所消费的「上游
new-api 端点」, 不是 TunTunShu 自己暴露的路由。** 两种请求头模式:

- **用户级**(`Authorization: Bearer <accessToken>` + `new-api-user: <userId>` +
  Edge-like `User-Agent`):checkin `POST /api/user/checkin`、 getCheckinStatus
  `GET /api/user/checkin`、getUserSelf `GET /api/user/self`、listTokens
  `GET /api/token/?p&size`、 getTokenKey 优先 `POST /api/token/:id/key`(404/405
  时兼容旧版 `GET /api/token/:id/key`)。
- **API-Key 级**(仅 `Authorization: Bearer <apiKey>`——此 apiKey 是**上游 token**
  `api_keys.key`,**不是**本地代理 Key):getModels
  `GET /v1/models`、chatCompletions `POST /v1/chat/completions`。
- healthCheck `GET /`(无鉴权头)。

**new-api 约定**:token 无效时也回 HTTP 200,业务成败在 `body.success`。services
一律用 `ok = response.ok && data.success === true` 判定。

**Token 发现流程**(`account_service.syncAccountApiKeys`,手动专用):分页
listTokens(每页最多 100) → 优先使用旧版 listTokens item 中的明文
`key`(非空且不含 `*`,原样 trim 后写入),否则对 `{id}` 调 getTokenKey → 按
`(account_id, key)` upsert 进 `api_keys`,并用上游 token.status 同步本地
`api_keys.enabled` (new-api:1=启用,2=禁用,3=过期,4=额度耗尽;本地仅 1 视作
enabled=true)。高版本 listTokens 可能返回脱敏 `key`,不得直接使用。仅当 token
列表与每个 token key 都完整获取成功时,才把本地同账号但本轮未发现的 `api_keys`
删除,并先删除归属于该 Key 的 `upstream_models`;若列表失败或任一 key
获取不完整,跳过删除以避免误删。本流程默认会对本轮新增且启用的本地 Key 立即调用
`syncApiKeyModels` 拉取模型;`refreshAccount`
内部会关闭该默认,避免账号创建/编辑后的完整刷新重复拉模型。

## AI SDK test path(services/upstream_model_test_service.ts)

`testUpstreamModel(id, kind)` 经 Vercel AI SDK **直连上游 origin**(不走
adapter),用上游 `api_keys.key` 作
apiKey。`endpoint_type`(`openai_chat`/`openai_responses`/`claude_messages`/`gemini_generate`)
决定 provider;**endpoint_type 仅用于测试,不影响线上代理路由**。kind ∈
`chat|vision|tool`(随机算术/复述、 按 `lib/test_images.ts`
的图片识别颜色、或工具调用)。`maxRetries=0`,超时 `max(header_timeout,15)s`。
openai_chat 路径用一个 fetch 包装把裸 base64 的 `image_url` 修成合法 `data:`
URL。UI 中体现为每个上游模型的 对话测试 / 图像识别 / 工具调用 按钮。

## Database

- **建表**:`db/init.ts` 启动时执行——对 8
  张表(sites、accounts、api_keys、models、upstream_models、
  request_logs、system_task_logs、system_settings)`create table if not exists`;另建
  2 个唯一索引 (`sites_origin_key`、`accounts(site_id,user_id)`),包在 try/catch
  里(有重复数据时告警并继续);
  以及**唯一的一处列回填**:`alter table upstream_models add column if not exists endpoint_type ...`。
  (“无 migration”成立,但确有一处列回填。)
- **无任何 FK 约束**——所有 `*_id` 是裸 `bigint`。级联删除在应用代码里自顶向下做
  (deleteSite → accounts → api_keys → upstream_models)。**例外:deleteModel
  是「解除映射」 (置 `upstream_models.model_id=null`)而非删除上游模型。**
- **ID**:`bigserial`/`bigint`,TS 侧类型为 `number`。`system_settings` 主键是
  `key`(text),是个 KV 存储。
- **命名**:SQL 用 snake_case。**postgres 原始行保留 snake_case 键**(未配置
  transform),直接作为 `/api` JSON 返回;camelCase 仅出现在手写的入参/返回对象与
  `types/models.ts`(islands 并不引用它)。
- **Upsert**:createSite(按 origin)、createAccount(按 site_id,user_id)先查再
  catch 23505 (`isUniqueViolation`)。
- **持久化范式**:service 函数直接 `getSql()` + 标签模板 SQL。`db/repositories/`
  与 `db/schema/tables.ts` 是未使用的空壳。

### Tables & status enums(types/enums.ts)

- `sites.status`: unknown | healthy | down
- `accounts.status`: unknown | healthy | invalid | quota_empty;`checkin_status`:
  unknown | checked | unchecked | manual_required | failed
- `api_keys.status`: unknown | healthy | invalid | quota_empty
- `upstream_models.status`: unknown | healthy | invalid(**无
  'down'**);`endpoint_type`: 上述 4 种;`model_id` **可为 null**(未映射)
- `request_logs.status`: success | failed;`request_type`: final | retry
- `system_task_logs.task_type`: site_health_check | account_checkin |
  account_quota_sync | account_api_key_sync | api_key_model_sync |
  request_log_flush | request_log_cleanup;`status`: success | failed | skipped

### Entity relationships

```
Site 1:N Account 1:N ApiKey 1:N UpstreamModel
Model 1:(0..N) UpstreamModel        # 可选/可空映射;无 FK 强制
```

## Scheduled jobs & manual tasks

在 main.ts 顶层注册(`typeof Deno.cron === "function"` 守卫,每个
try/catch)。schedule 在启动时经 `getSettings()` **一次性**读取——**改 `cron_*`
设置需重启生效**。时间按 **UTC**(Deno.cron 无时区; 星期 1-7)。任务只取 `enabled`
记录。

| Cron 名             | 设置键                     | 默认(UTC)         | 手动端点                              |
| ------------------- | -------------------------- | ----------------- | ------------------------------------- |
| account_checkin     | `cron_account_checkin`     | `0 0,8,16 * * *`  | `POST /api/tasks/account-checkin`     |
| account_quota_sync  | `cron_account_quota_sync`  | `10 0,8,16 * * *` | `POST /api/tasks/account-quota-sync`  |
| site_health_check   | `cron_site_health_check`   | `0 * * * *`       | `POST /api/tasks/site-health-check`   |
| api_key_model_sync  | **`cron_model_sync`**      | `0 12 * * *`      | `POST /api/tasks/api-key-model-sync`  |
| request_log_cleanup | `cron_request_log_cleanup` | `30 3 * * *`      | `POST /api/tasks/request-log-cleanup` |

注意 `api_key_model_sync`(cron 名)↔ `cron_model_sync`(设置键)的命名不一致。

`account_api_key_sync` 是**手动专用**(无 cron,不在
jobs/)——`POST /api/tasks/account-api-key-sync` 对**所有**账号(无 enabled 过滤)调
`account_service.syncAccountApiKeys`。

`jobs/runner.ts` 的 `runForIds` **严格串行**地遍历 id,逐个
await,捕获单个错误计为 failed (不中断整批),返回
`{total,success,failed,skipped,results}`。account_checkin 用自定义 classify 把
`checkinStatus==='manual_required'` 归为 skipped。**system_task_logs 由 service
层写,不是 runner。**

**账号刷新编排**:`POST /api/accounts` 与 `PATCH /api/accounts/:id` 在
upsert/更新后
`void refreshAccount(id)`(fire-and-forget,接口立即返回;编排在后端而非前端)。
`refreshAccount` 先并发 `syncAccountQuota` ‖ `syncAccountApiKeys`(分写
accounts/api_keys 不冲突),待 ApiKey 就绪再并发对每个 key
`syncApiKeyModels`(模型依赖 key 先存在)。各子步骤 best-effort(自身 try/catch、写
system_task_logs、不抛错),故 **进程重启会丢失该次刷新**。

## System settings(lib/config.ts `defaultSettings` —— 10 个键)

| 键                                   | 默认     | 谁读取                                        |
| ------------------------------------ | -------- | --------------------------------------------- |
| `proxy_auth_keys`                    | `""`     | `/v1/*`(附加 Key;读写时总会前置去重 AUTH_KEY) |
| `request_log_retention_days`         | `"30"`   | request_log_cleanup 任务                      |
| `request_log_flush_interval_minutes` | `"0"`    | **死配置 —— 无任何读取方**                    |
| `upstream_header_timeout_seconds`    | `"60"`   | 代理 + 测试服务                               |
| `channel_retry_count`                | `"0"`    | 代理                                          |
| 5 个 `cron_*`                        | (见上表) | 启动时被 cron 读取                            |

`updateSettings` 只持久化 `defaultSettings`
中已存在的键(未知键静默丢弃);`getSettings` 把 DB 行 叠加在默认值之上。

## Frontend

- **页面 →
  island**:index→DashboardApp、login→LoginCard(+ThemeToggle)、upstream→UpstreamApp、
  models→ModelsApp、logs→LogsApp、settings→SettingsApp。导航 4
  项(upstream/models/logs/settings), 仪表盘经品牌链接进入。
- **components/admin_api.ts**:localStorage token 键 `tts-auth`;`api()` 自动加
  `/api` 前缀与 Bearer; 401 时清 token 并跳 `/login`。主题存 localStorage
  `tts-theme`(_app.tsx 防 FOUC 引导脚本)。
- **UpstreamApp**:4 列 Miller 钻取(站点→账号→Key→模型)带每列搜索。选中项与各列
  搜索词以 URL query 为**唯一事实来源**(`use_url_state.ts`:首帧/SSR 为空以避免
  hydration mismatch,挂载后一帧补上);选中只由点击或 URL 显式触发,**无「候选恰剩
  一项时自动选中」的隐式收敛**。行操作:站点 检测/编辑/删除,账号 签到/拉Key(新增
  Key 后自动拉模型)/编辑/删除,Key 拉取模型/删除;启停经
  PATCH。模型叶子:端点类型下拉(PATCH endpointType)、映射下拉(PATCH
  modelId,含「清除映射」→ null 与「＋新增统一模型」→ POST
  /models)、测试按钮。模型列表排序:启用优先,组内名称不区分大小写
  a→z。probe-name「自动获取」自动填站点/账号名。账号「签到」按钮成功后**仅在前端**追加
  一次 best-effort `sync-quota` 刷额度——后端 `checkinAccount`(及
  cron/批量任务)只 签到不刷额度,因该函数被批量共用。
- **「快捷录入」**按钮打开 `/tuntunshu.user.js?key=<token>`——安装油猴脚本
  (`lib/userscript.ts`)在 new-api 站点一键录入站点+账号。登录态解析遵循
  **旧版优先、新版兜底**:先读取 `localStorage.user` 并以 `/api/user/self` 验证旧
  session; 本地用户缺失/无效或旧验证返回 401 时,才调
  `POST /api/user/auth/refresh` 获取新版 Dashboard Bearer token。短期 Dashboard
  token 仅在脚本内存中用于同源 new-api 请求,最终保存到囤囤鼠的是
  `/api/user/token` 新生成的长期 access token。已录入判定会用 origin/userId
  搜索分页后台 API 并逐页精确匹配,避免记录不在第一页时绕过覆盖确认。保存账号前
  `ensureApiKeys` 确保该用户 ≥1 个 APIKey:为 0 时按可用分组各建一个
  `unlimited_quota`、`expired_time:
  -1`(**必须显式传 -1**,零值 0 会被 new-api
  当作已过期)的 `DEFAULT` 密钥;全程 best-effort,且只回传
  siteId/userId/accessToken,**不回传 APIKey**(由后端 同步拉取)。
- **ModelsApp** 通道弹窗有一个真实代理往返测试(`POST /v1/chat/completions`)。
- **LogsApp(系统日志)**:关联对象分三列(站点/账号/APIKey),有值单元格是链接,跳
  `/upstream?site=&account=&key=`
  并带到该层为止的父级链供上游页逐级选中;反查补全 (key→账号→站点)在日志侧用
  `/accounts`、`/api-keys` 已返回的 `site_id`/`account_id`
  一次性完成,引用已删实体时名称回退 `#<id>`。
- 各 island 普遍带 loading/busy 态与客户端表单校验。

## Tests

测试均为纯 `Deno.test`,无 std/assert 依赖:

- `lib/pagination_test.ts`:分页参数与响应形状。
- `lib/sse_test.ts`:SSE usage 嗅探、跨分片重组、无 usage 时返回 null。
- `lib/userscript_test.ts`:用轻量浏览器 mock 执行生成脚本,覆盖新旧 new-api
  鉴权顺序、401 fallback、Bearer 隔离、分页已录入判定、录入与取消覆盖。

运行 `deno test -A`。

上游模型测试是运行时功能,不是自动化测试。

## Dead config(尚存)

Fresh
脚手架与未使用的空壳已清理。仅剩一处未接线的设置:`request_log_flush_interval_minutes`
(`defaultSettings` 默认 `"0"`)及其配套的 `request_log_flush`
任务类型(types/enums.ts)—— 当前**无任何读取方**,SettingsApp
里仍有对应输入框。看起来是为「缓冲式请求日志刷盘」预留、尚未实现;
要么实现它,要么连同 UI 字段与 enum 值一并移除。

## Gotchas

- **Vite 必须把 AI SDK 标为 external**(vite.config.ts 的 `ssr.external` +
  `build.rollupOptions.external` 经 `isAiExternal`):`ai`/`@ai-sdk/*` 的传递依赖
  `@vercel/oidc` 是 CJS 具名导出,rollup 无法解析。 运行时由 Deno 经 import map +
  node_modules 解析这些裸导入。新增 AI SDK 依赖时同步这份清单。
- `GET /tuntunshu.user.js` 无鉴权(main.ts 中间件),只嵌入调用方传入的
  `?key=`。错误 key 装出的脚本调 API 会 401。
- 版本号:UI 页脚/登录页显示 `v1.4.2`,油猴脚本独立 `@version 1.3.2`;`deno.json`
  无 version 字段。
