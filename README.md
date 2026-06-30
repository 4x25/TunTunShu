# TunTunShu(囤囤鼠)

单用户的多上游 AI 聚合 / 中转代理,自带后台管理 UI:管理 new-api
站点/账号/Key/模型,对外暴露 OpenAI 兼容的 `/v1/*` 代理(随机路由 + 可选重试 +
token 用量记录),并用 `Deno.cron` 定时签到、同步额度/模型、健康检查、清理日志。

## 快速开始

```bash
cp .env.example .env   # 至少配置 AUTH_KEY 与 DATABASE_DSN
deno task dev          # 开发(Vite HMR)

deno task build && deno task start   # 生产
```

## 文档

完整的架构、命令、环境变量、路由清单、数据库约定与定时任务说明见
**[AGENTS.md](./AGENTS.md)** —— 本仓库的唯一事实来源。
