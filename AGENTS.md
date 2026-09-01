# AGENTS.md — TunTunShu (囤囤鼠)

> **本文件是本仓库的唯一事实来源(single source of truth)。** `CLAUDE.md`
> 只是指向这里。改动行为时请同步更新本文件。

## Overview

TunTunShu 是一个**单用户的多上游 AI 聚合 / 中转代理**,自带后台管理
UI。它管理一棵 new-api 资源树(站点 Site → 账号 Account → API Key → 上游模型
UpstreamModel),对外暴露 **OpenAI 兼容的 `/v1/*`
代理**:客户端请求一个逻辑模型名,服务在所有健康的上游候选里随机选一个
(可选重试)转发并记录 token 用量。后台 `Deno.cron`
负责签到、额度/模型同步、站点健康检查、日志清理；普通 API 签到遇到可信的
Cloudflare Challenge / Turnstile 时可用 CloakBrowser 打开个人中心自动完成验证。

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
- **浏览器自动化(仅服务端)**:`cloakbrowser@0.5.10` +
  `playwright-core@1.62.1`,仅用于签到的人机验证
  fallback。浏览器二进制在生产构建时下载进 `_fresh/cloakbrowser`,两个 npm
  包同样必须保持 Vite external。
- **不使用**: DrizzleORM、Prisma、Hono、React、ShadcnUI。

## Commands

```bash
deno task check    # deno fmt --check . && deno lint . && deno check  (注意:deno check 无路径参数)
deno task dev      # vite(HMR 开发服务器)
deno task cloak:install # 下载 CloakBrowser 二进制到 _fresh/cloakbrowser
deno task cloak:smoke   # 显式 opt-in 的真实账号浏览器签到冒烟(见 Tests)
deno task build    # vite build → _fresh/,随后自动执行 cloak:install
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
推送前先在本地跑通上面的校验三步。生产构建会把平台对应的 CloakBrowser 二进制
放入 `_fresh/cloakbrowser`;运行时优先复用该产物并默认禁用自动更新,避免冷启动下载
或构建后静默换版。

## CI

GitHub Actions(`.github/workflows/ci.yml`)在 push / PR 到 `master` 时,在
ubuntu-latest 上跑四步:`deno install`(补齐
node_modules——`nodeModulesDir:
"manual"` 必须先装,否则 `deno check` 因缺包失败)→
`deno task check`(fmt --check + lint + check 静态校验)→ `deno test -A`(测试)→
`deno task build`(vite build 后下载并校验 CloakBrowser 构建产物;需要能访问
CloakBrowser 下载源,仍不连接数据库、无需应用必填 env)。权限收敛为
`contents:
read`。CI 只做质量门禁,**不负责部署**——部署仍由 Deno Deploy
在推送时自动完成。

## Environment

| Env                        | 必填 | 默认             | 说明                                                                           |
| -------------------------- | ---- | ---------------- | ------------------------------------------------------------------------------ |
| `AUTH_KEY`                 | 是   | —                | 管理登录口令 + 默认代理 Key;**首次调用 getAuthKey() 时**才抛错                 |
| `DATABASE_DSN`             | 是   | —                | PostgreSQL DSN;缺失时**启动即抛错**(initializeDatabase → getSql)               |
| `HOST`                     | 否   | `0.0.0.0`        | 监听地址                                                                       |
| `PORT`                     | 否   | `4025`           | 监听端口                                                                       |
| `TZ`                       | 否   | `Asia/Shanghai`  | 时区;**不影响 cron**——Deno.cron 一律按 UTC 解释                                |
| `CLOAKBROWSER_LICENSE_KEY` | 否   | —                | 作为 `licenseKey` 传给安装/启动;Free Key 用 latest stable,未设时用 legacy v146 |
| `CLOAKBROWSER_BINARY_PATH` | 否   | 构建内二进制     | 显式指定已有 Chromium 可执行文件,跳过内置下载路径                              |
| `CLOAKBROWSER_VERSION`     | 否   | wrapper 对应版本 | 固定完整 Chromium 版本号,供免费/付费版本复现或回滚                             |

## Entrypoint & Startup(main.ts)

启动顺序:`app.use(staticFiles())` → 中间件服务 `GET /tuntunshu.user.js` 与
`GET /tuntunshu-login.user.js`(均无鉴权)→ `await initializeDatabase()` →
`if (typeof Deno.cron === "function")` 注册 5 个 cron 任务(schedule 在此处经
`getSettings()` **一次性**读取,每个任务体各自 try/catch)→
`app.fsRoutes()`。main.ts 里没有显式 `Deno.serve`——服务由
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
  checkin_classifier.ts              直连签到结果/可信 Cloudflare challenge 分类 + 浏览器设置归一化
  browser_checkin_service.ts         CloakBrowser 个人中心自动签到与运行时状态
  browser_checkin_lease_service.ts   PostgreSQL 全局浏览器租约(跨 Deploy 实例串行)
adapters/new_api_adapter.ts   对上游 new-api HTTP 的薄 fetch 封装
db/client.ts     postgres 单例 getSql()(max:5, idle_timeout:20, connect_timeout:10;池被 cron 与 HTTP 共用)
db/init.ts       启动时建表(见 Database)
jobs/            5 个 cron 任务函数 + runner.ts(串行批处理器)
lib/             auth、env、config(defaultSettings)、mask、request、response、sse、userscript、upstream_login_userscript、test_images
scripts/         install_cloakbrowser.ts(构建期下载/冻结版本)、smoke_browser_checkin.ts(显式 opt-in 真实签到)
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
- **checkin-automation**:`GET /api/checkin-automation/status`(返回已归一化的
  `enabled`/`timeoutSeconds`、runtime 可用性/版本与全局租约 busy;不返回二进制
  路径或许可证)
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

## Browser-assisted check-in fallback

`checkinAccount` 每次仍先用 adapter 直连 `POST /api/user/checkin`,transport
timeout 为 15s。普通成功/「已签到」或业务失败完全不启动浏览器。只有两类可信信号
进入 fallback:上游 JSON message 明确含
Turnstile/Captcha/验证码/人机验证,或响应带 `cf-mitigated: challenge`;另兼容
403/429/503 且同时有 Cloudflare 归属 header 与 challenge HTML marker。任意普通
HTML/4xx/5xx 不得误触发高成本浏览器。

fallback 每次从 `system_settings` 读取开关和 30–120s 总预算,因此保存后立即生效。
开启时先争抢 PostgreSQL `browser_checkin_leases(name='global')`:最多等待
`min(10s,总预算)`,拿到后租约初始 TTL 150s、每 20s heartbeat,并把已经等待的时间从
浏览器预算扣除。全局租约让同一数据库上的多个 Deno Deploy 实例最多只运行一个
CloakBrowser；拿不到租约时保持 `manual_required` + skipped,不排后台队列。

`browser_checkin_service` 动态加载 server-external 的 CloakBrowser,固定
`headless:true`、`humanize:true` + `humanPreset:'careful'`,在临时 persistent
profile 内打开上游个人中心。执行前对 origin 格式及 A/AAAA 解析结果做 SSRF
检查,把选定的公网地址用 Chromium `--host-resolver-rules` 固定到本次任务以避免
DNS rebinding,并在 browser context 层只放行该 origin 与
`https://challenges.cloudflare.com`;HTTP 与 WebSocket 分别由 `route` /
`routeWebSocket` 执行同一 allowlist；目标站所有 document realm 在脚本执行前禁用
WebSocket、Worker/SharedWorker、WebTransport 与 WebRTC(Cloudflare challenge
origin 例外)。公网判定对 IPv6 采用 global-unicast allowlist 并排除 NAT64、6to4、
文档/协议专用网段。service worker 与下载被禁用。Chromium 子进程环境采用
allowlist(`Deno.Command` 探测额外使用 `clearEnv:true`),不会继承
`AUTH_KEY`、`DATABASE_DSN` 等应用 secrets(仅按需透传 CloakBrowser
license)。自动化与公开免登油猴脚本共用
`buildUpstreamLoginRuntimeSource()`:PAT/userId/user 由 Playwright init-script
放入页面内存 bootstrap,共享 runtime 同步取走后只保存在闭包中,**不会写入
URL、sessionStorage 或 localStorage**。

`CLOAKBROWSER_LICENSE_KEY` 在构建期显式传给 `ensureBinary(licenseKey)`,运行期
显式传给 `launchPersistentContext({licenseKey})`。GitHub Free Key 因此会在构建时
取得当时的 latest stable(单并发);未配置 key 才使用免许可证的 legacy v146。本地
安装与浏览器运行都优先使用进程环境,未设置时才由 `lib/cloakbrowser_license.ts`
从被 gitignore 的 `.env` 读取这一项；Deno Deploy/CI 没有 `.env`
时继续使用平台注入的环境变量或无 key fallback。

入口页处理完成后会新开一个专用自检 document:page-level init script
在任何上游脚本 执行前捕获原生 fetch 并立即 `window.stop()`,再用该 fetch 完成
logout 与带 PAT 的 `/api/user/self`;因此请求沿用同一个被 DNS pin 的 Chromium
网络栈/CF Cookie,且 上游页面脚本没有机会覆写 fetch 或读取自检参数。

执行器先处理站点入口 challenge。签到页候选依次为 `/profile`、
`/console/personal`、`/console`,并兼容中英文签到按钮；完成
Turnstile/签到后必须以 `GET /api/user/checkin` 的 `checked_in_today`
确认结果。`finally` 总会关闭 context、删除临时 profile；外层编排停止 heartbeat
并释放租约。总预算由外层 deadline race 强制约束,DNS/import/launch 卡住也能返回;
context close 与 profile 删除另有短清理上限。SIGINT 会主动 abort/关闭所有活跃
context 并释放当前进程持有的 PostgreSQL lease 后再退出,适配 Deno Deploy
eviction。若 launch/close 超过二次清理上限,结果为 `cleanup_failed`:外层停止
heartbeat 但不删除 lease row,让它保留到 150s TTL 后再开放执行槽；迟到的 workflow
仍挂有最终 close/profile 删除回调。close 拒绝/超时会按该任务唯一的
`--user-data-dir` 查找并 TERM→KILL 自己的 Chromium；无法确认退出时保留
`activeRuns` 供 SIGINT 继续处理,避免立刻并发下一浏览器。SIGINT 先关闭浏览器,
只有全部确认退出才删除 lease；否则仅停 heartbeat、由 TTL 隔离。

一次 `checkinAccount` 无论是否 fallback 都只写一条最终 `account_checkin`
日志。浏览器成功 → `checked`/success;功能关闭或租约 busy →
`manual_required`/skipped;浏览器已经启动但超时、UI 不兼容或内部失败 →
`manual_required`/failed。返回值额外带 `checkinMethod:'direct'|'browser'`
与脱敏的 `automation:{attempted,code,durationMs}`;
PAT、fragment、二进制路径和许可证不得进入 API 或日志。

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

- **建表**:`db/init.ts` 启动时执行——对 9
  张表(sites、accounts、browser_checkin_leases、api_keys、models、
  upstream_models、request_logs、system_task_logs、system_settings)
  `create table if not exists`;另建 2 个唯一索引
  (`sites_origin_key`、`accounts(site_id,user_id)`),包在 try/catch
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
- `browser_checkin_leases`:以固定主键 `name='global'` 保存 owner 与
  `expires_at`,用于多个 Deno Deploy
  实例之间原子争抢唯一浏览器执行槽；过期租约可被新执行者接管,运行中由 heartbeat
  延期,结束时仅 owner 可释放。

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
`{total,success,failed,skipped,results}`。account_checkin 用自定义 classify:
`manual_required` 且浏览器未启动(功能关闭/全局租约繁忙)计为
skipped,浏览器已启动但失败计为 failed。**system_task_logs 由 service 层写,不是
runner。**

**账号刷新编排**:`POST /api/accounts` 与 `PATCH /api/accounts/:id` 在
upsert/更新后
`void refreshAccount(id)`(fire-and-forget,接口立即返回;编排在后端而非前端)。
`refreshAccount` 先并发 `syncAccountQuota` ‖ `syncAccountApiKeys`(分写
accounts/api_keys 不冲突),待 ApiKey 就绪再并发对每个 key
`syncApiKeyModels`(模型依赖 key 先存在)。各子步骤 best-effort(自身 try/catch、写
system_task_logs、不抛错),故 **进程重启会丢失该次刷新**。

## System settings(lib/config.ts `defaultSettings` —— 12 个键)

| 键                                   | 默认     | 谁读取                                        |
| ------------------------------------ | -------- | --------------------------------------------- |
| `proxy_auth_keys`                    | `""`     | `/v1/*`(附加 Key;读写时总会前置去重 AUTH_KEY) |
| `request_log_retention_days`         | `"30"`   | request_log_cleanup 任务                      |
| `request_log_flush_interval_minutes` | `"0"`    | **死配置 —— 无任何读取方**                    |
| `upstream_header_timeout_seconds`    | `"60"`   | 代理 + 测试服务                               |
| `channel_retry_count`                | `"0"`    | 代理                                          |
| `browser_checkin_enabled`            | `"true"` | 签到 challenge 是否启用 CloakBrowser fallback |
| `browser_checkin_timeout_seconds`    | `"120"`  | 浏览器签到总时限(服务端归一化到 30–120 秒)    |
| 5 个 `cron_*`                        | (见上表) | 启动时被 cron 读取                            |

`updateSettings` 只持久化 `defaultSettings`
中已存在的键(未知键静默丢弃);`getSettings` 把 DB 行叠加在默认值之上。
`browser_checkin_enabled` 仅精确字符串 `"true"` 归一化为开启,其它值均为
`"false"`; timeout 用 `parseInt` 后 clamp 到 30–120,空值/非法值回默认
120。两项在读历史 DB 值和写入时都会归一化,故运行时与 Settings UI
一致,并在每次签到时读取、立即生效。

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
  Key 后自动拉模型)/编辑/删除,Key 拉取模型/删除;启停经 PATCH。APIKey
  行的密钥密文右侧有复制按钮(`components/clipboard.ts`:优先
  `navigator.clipboard`,非安全上下文退回 `execCommand`
  选区兜底),复制的是列表接口原样返回的**完整明文 Key**(密文仅前端 `maskKey`
  展示),成功后按钮短暂显示对勾并走 flash 提示。 模型叶子:端点类型下拉(PATCH
  endpointType)、映射下拉(PATCH modelId,含「清除映射」→ null
  与「＋新增统一模型」→ POST
  /models)、测试按钮。模型列表排序:启用优先,组内名称不区分大小写
  a→z。probe-name「自动获取」自动填站点/账号名。账号「签到」请求执行期间按钮显示
  「验证中…」;最终仍需人工处理时以黄色显示「需手动」。按钮签到成功后**仅在前端**
  追加一次 best-effort `sync-quota` 刷额度——后端 `checkinAccount`(及
  cron/批量任务)只签到不刷额度,因该函数被批量共用。
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
- **上游账号 PAT 免登**:工具栏「免登脚本」安装公开的
  `/tuntunshu-login.user.js`(`lib/upstream_login_userscript.ts`,脚本版本
  `1.0.0`), 账号行「登录」仅在当前页检测到脚本同步暴露的
  `globalThis.__TTS_UPSTREAM_LOGIN_SCRIPT__ === "1.0.0"` 后才会构造并打开
  `<site-origin>/#__tts_upstream_login__?accessToken=...&userId=...`。未安装或
  版本不符时**不得把 PAT 放入 URL**,只提示并打开安装入口。账号列表额外返回
  `site_origin` 供登录使用(仍保留裸 `site_id`),避免站点分页尚未加载时无法登录;
  站点必须是无路径、查询、fragment 或 URL 用户信息的纯 `http(s)`
  origin。新标签以 `noopener,noreferrer` 打开,脚本以最终页面的 `location.origin`
  为准。
- 免登脚本在 `document-start` 把 fragment 凭据转存为当前标签的
  `sessionStorage["tts-upstream-login"]`,同步清 fragment 并停掉首次页面加载。
  它先用不带 PAT 的新/旧 logout 清原 Cookie session 和共享
  `localStorage.user/uid`,再以 `credentials:"omit"` +
  `Authorization: Bearer <accessToken>` + `New-Api-User: <userId>` 请求
  `/api/user/self`;仅业务成功且返回用户 ID 一致时激活并 reload,失败一律清状态。
  active 状态在刷新后恢复,关闭标签后随 sessionStorage 消失;同 origin
  的其他普通登录标签会被一并登出,复制标签/浏览器会话恢复可能复制凭据,HTTP
  上游会显示明文风险警告。
- 脚本只覆写当前页面 realm 的同 origin `/api/*` fetch/XHR,覆盖页面自带的两项
  鉴权头;fetch 普通 API 强制 `credentials:"omit"`,XHR 则依赖启动阶段先清除
  Cookie(浏览器无法禁止同源 XHR 携带之后重新产生的 Cookie)。外域、静态资源与
  `/v1/*` 不注入;旧版路由守卫通过仅限当前标签的 `localStorage.user/uid` shadow
  兼容。新版 `/api/user/auth/refresh` 被转换为 PAT `/api/user/self`
  校验并返回前端 AuthBundle: `access_token` 始终为原
  PAT,`access_expires_at=253402300799`,其中 `session`
  只是前端结构校验所需的占位对象,**不会在 new-api 后端创建 Session**。脚本禁止
  `/api/user/token` 落网,不会生成或轮换 PAT。Session
  管理、2FA、Passkey、Security Proof、Playground 等真实 Session
  专属功能不受支持;WebSocket、原生 EventSource、sendBeacon、Worker 内 fetch
  与其他 realm 也不承诺拦截。上游原生 logout 或旧版清除 `localStorage.user/uid`
  时会立即删除免登状态并停用当前页补丁,避免 SPA 同页重新登录后仍误用旧
  PAT;退出统一导航旧版兼容路径 `/login`(新版会自行重定向到 `/sign-in`)。
- **ModelsApp** 通道弹窗有一个真实代理往返测试(`POST /v1/chat/completions`)。
- **SettingsApp** 的「浏览器自动签到」区可立即启停 fallback、设置 30–120 秒总
  超时,并经 `GET /api/checkin-automation/status` 展示 CloakBrowser wrapper /
  Chromium 版本与全局租约的忙闲状态；状态 API/UI 均不展示 binary path 或许可证。
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
- `lib/upstream_login_userscript_test.ts`:覆盖免登脚本元数据与普通页面无副作用、
  fragment 两阶段启动、logout 与 `/self` 校验、sessionStorage/Storage shadow、
  fetch/XHR 同源注入及外域隔离、新版 AuthBundle、禁止 PAT 轮换与退出清理,以及
  CloakBrowser memory-only bootstrap 不把凭据写入 URL/Storage。
- `components/upstream/upstream_login_test.ts`:覆盖脚本 marker 版本门禁、纯
  HTTP(S) origin 校验与 fragment 凭据编码。
- `services/checkin_classifier_test.ts`:覆盖直连成功/普通失败/明确 captcha
  与可信 Cloudflare challenge 分类,以及浏览器开关/超时安全归一化。
- `services/browser_checkin_lease_service_test.ts`:用内存 lease store +
  注入时钟覆盖 busy 等待、heartbeat、owner-only release 和优雅退出释放。
- `services/account_checkin_test.ts` + `jobs/account_checkin_job_test.ts`:覆盖
  direct fast path、fallback 门禁、租约等待计入预算、浏览器成功/失败与批任务
  success/failed/skipped 分类。
- `services/settings_service_test.ts`:覆盖浏览器开关与 30–120s timeout 在 DB
  读写边界的规范化规则。
- `lib/browser_checkin_security_test.ts`:覆盖纯公网 HTTP(S) origin 门禁与常见
  IPv4/IPv6 私网、NAT64/6to4、文档/保留地址拒绝。
- `lib/cloakbrowser_license_test.ts`:覆盖 key 从 dotenv
  的普通、export、单双引号与 inline comment 语法读取,且不输出/持久化真实
  secret。
- `services/browser_checkin_service_test.ts`:用 canary 覆盖错误脱敏,确保 PAT、
  Bearer、URL 凭据和 Turnstile/Captcha token 不进入日志/API message,并验证
  WebSocket 与 HTTP 使用相同 origin allowlist。

运行 `deno test -A`。

上游模型测试是运行时功能,不是自动化测试。

`deno task cloak:smoke` 同样**不属于自动化测试**,会对真实账号执行签到并产生外部
副作用。脚本默认拒绝运行,必须显式设置 `TTS_CLOAK_LIVE=1` 以及
`TTS_CLOAK_LIVE_ORIGIN`、`TTS_CLOAK_LIVE_USER_ID`、
`TTS_CLOAK_LIVE_ACCESS_TOKEN`;可选 `TTS_CLOAK_LIVE_TIMEOUT_SECONDS` 仍会 clamp
到 30–120。不要在 CI 中运行或把这些临时凭据写入仓库/日志。

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
- **CloakBrowser / Playwright 也必须保持 server external**:`cloakbrowser`
  需要原始包结构、Node 内建模块与独立 Chromium 二进制,`playwright-core`
  负责运行时控制;`vite.config.ts` 的 `ssr.external` 与 `isBrowserExternal`
  必须同步。依赖精确固定为 `cloakbrowser@0.5.10` / `playwright-core@1.62.1`,升级
  wrapper 时必须重新实测 Cloudflare challenge、构建下载和 Deno Deploy 启动。
  CloakBrowser 的声明依赖 Node 类型；本仓
  `nodeModulesDir:"manual"`,故还需根级精确 `@types/node@26.0.1`,不能依赖上游
  devDependency 被隐式安装。
- `deno task build` 会先让 Vite 重建 `_fresh`,再执行
  `cloak:install`;不要反转顺序或依赖 Vite 保留未知文件,必须保证最终上传的
  `_fresh` 已包含浏览器。构建脚本强制在该次下载禁用自动更新,运行时 service
  也默认 `CLOAKBROWSER_AUTO_UPDATE=false`；只有用户显式设置才
  覆盖。安装脚本还会写入 `tuntunshu-install.json`,运行时据此把本次构建验证过的
  binary 固定为 `CLOAKBROWSER_BINARY_PATH`,不会因 Production-only
  license/version 在请求内冷下载另一个版本。要让 GitHub Free/Pro key
  或版本选择影响构建产物, **必须把相同的 `CLOAKBROWSER_LICENSE_KEY` /
  `CLOAKBROWSER_VERSION` 同时配置给 Deno Deploy Build 环境**；仅配 Production
  不会替换已构建的 binary。
- CloakBrowser 在 Linux 默认模拟 Windows；若运行环境没有完整 Windows font set,
  启动时会警告字体指纹不一致并可能降低 challenge 通过率。不要仅用
  `CLOAKBROWSER_SUPPRESS_FONT_WARNING` 隐藏问题；字体受授权约束,应由部署环境合法
  提供并在目标站实测,当前仓库不捆绑微软字体。
- `GET /tuntunshu.user.js` 无鉴权(main.ts 中间件),只嵌入调用方传入的
  `?key=`。错误 key 装出的脚本调 API 会 401。
- `GET /tuntunshu-login.user.js` 同样无鉴权,但源码只包含通用免登逻辑和自身
  安装/更新 URL;PAT/userId 仅在账号「登录」点击后进入目标上游的 URL fragment。
- 版本号:UI 页脚/登录页显示 `v1.5.0`,快捷录入油猴脚本独立 `@version 1.3.2`,
  上游免登油猴脚本独立 `@version 1.0.0`;`deno.json` 无 version 字段。
