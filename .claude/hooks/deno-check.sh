#!/usr/bin/env bash
# Stop hook:一轮回复结束时,若本轮改过 .ts/.tsx,自动跑 `deno task check`
# (deno fmt --check + lint + check)。失败则用 decision:block 把输出反馈给模型,
# 促其修复后再结束本轮。仅作静态校验,不跑 deno task dev。

input=$(cat)

# 依赖 jq 解析;缺 jq 或 deno 时静默放行(无法校验,不应误报)。
command -v jq >/dev/null 2>&1 || exit 0
command -v deno >/dev/null 2>&1 || exit 0

# 输入须为合法 JSON;畸形则放行(无法判定 stop_hook_active,放行优于误阻断/死循环)。
printf '%s' "$input" | jq -e . >/dev/null 2>&1 || exit 0

# 防无限循环:若本次 stop 已是上一次 stop-hook 阻断后的续跑,直接放行。
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$root" ] || exit 0
cd "$root" || exit 0

# 仅在存在未提交的 .ts/.tsx 改动(已修改 / 已暂存 / 新增未跟踪)时才校验,
# 纯问答或纯文档轮次跳过,避免每轮都跑重的 typecheck。
changed=$(
  {
    git diff --name-only -- '*.ts' '*.tsx' 2>/dev/null
    git diff --cached --name-only -- '*.ts' '*.tsx' 2>/dev/null
    git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null
  }
)
[ -n "$changed" ] || exit 0

out=$(NO_COLOR=1 deno task check 2>&1)
[ $? -eq 0 ] && exit 0

jq -n --arg r "deno task check 失败,请修复后再结束本轮:

$out" '{decision: "block", reason: $r}'
