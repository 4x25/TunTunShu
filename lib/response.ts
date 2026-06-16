export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function ok(data: unknown = { success: true }): Response {
  return json(data);
}

export function notImplemented(): Response {
  return json({ error: "Not implemented" }, 501);
}

function defaultErrorType(status: number): string {
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

/**
 * 构造 OpenAI 标准错误响应 `{ error: { message, type, code, param } }`,
 * 供 /v1/* 代理接口使用,保证 OpenAI SDK 等客户端能正确解析。
 */
export function openaiError(
  message: string,
  opts: {
    status?: number;
    type?: string;
    code?: string | null;
    param?: string | null;
  } = {},
): Response {
  const status = opts.status ?? 500;
  return json(
    {
      error: {
        message,
        type: opts.type ?? defaultErrorType(status),
        code: opts.code ?? null,
        param: opts.param ?? null,
      },
    },
    status,
  );
}
