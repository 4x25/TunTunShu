export interface NewApiUserAuth {
  origin: string;
  userId: string;
  accessToken: string;
}

export interface NewApiKeyAuth {
  origin: string;
  apiKey: string;
}

const NEW_API_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0";

export class NewApiAdapter {
  /** 无鉴权:GET /api/status,返回 new-api 公开状态(含 success/data 包裹)。 */
  async getStatus(origin: string, signal?: AbortSignal): Promise<Response> {
    return await fetch(`${origin.replace(/\/+$/, "")}/api/status`, {
      headers: { "User-Agent": NEW_API_USER_AGENT },
      signal,
      redirect: "follow",
    });
  }

  async checkin(
    auth: NewApiUserAuth,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await fetch(`${auth.origin}/api/user/checkin`, {
      method: "POST",
      headers: this.userHeaders(auth),
      signal,
    });
  }

  async getCheckinStatus(
    auth: NewApiUserAuth,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await fetch(`${auth.origin}/api/user/checkin`, {
      headers: this.userHeaders(auth),
      signal,
    });
  }

  async getUserSelf(
    auth: NewApiUserAuth,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await fetch(`${auth.origin}/api/user/self`, {
      headers: this.userHeaders(auth),
      signal,
    });
  }

  async listTokens(
    auth: NewApiUserAuth,
    page = 1,
    size = 100,
  ): Promise<Response> {
    return await fetch(`${auth.origin}/api/token/?p=${page}&size=${size}`, {
      headers: this.userHeaders(auth),
    });
  }

  async getTokenKey(auth: NewApiUserAuth, tokenId: number): Promise<Response> {
    const url = `${auth.origin}/api/token/${tokenId}/key`;
    const withMethod = (response: Response, method: "POST" | "GET") => {
      const headers = new Headers(response.headers);
      headers.set("x-tts-token-key-method", method);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    const post = await fetch(url, {
      method: "POST",
      headers: this.userHeaders(auth),
    });
    if (post.status !== 404 && post.status !== 405) {
      return withMethod(post, "POST");
    }

    await post.body?.cancel();
    const get = await fetch(url, {
      method: "GET",
      headers: this.userHeaders(auth),
    });
    return withMethod(get, "GET");
  }

  async getModels(auth: NewApiKeyAuth): Promise<Response> {
    return await fetch(`${auth.origin}/v1/models`, {
      headers: this.apiKeyHeaders(auth),
    });
  }

  /**
   * 模型广场的迷你性能柱数据:GET /api/perf-metrics/summary。
   * 新版 new-api 公开可用(pricing 模块公开时匿名即可),旧版没有该路由会回 404;
   * 需要登录的站点用任意账号的 accessToken + userId 走用户级请求头。
   */
  async getPerfMetricsSummary(
    origin: string,
    hours = 24,
    auth?: NewApiUserAuth,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await fetch(
      `${origin.replace(/\/+$/, "")}/api/perf-metrics/summary?hours=${hours}`,
      {
        headers: auth
          ? this.userHeaders(auth)
          : { "User-Agent": NEW_API_USER_AGENT },
        signal,
        redirect: "follow",
      },
    );
  }

  async chatCompletions(
    auth: NewApiKeyAuth,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await fetch(`${auth.origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        ...this.apiKeyHeaders(auth),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private userHeaders(auth: NewApiUserAuth): HeadersInit {
    return {
      Authorization: `Bearer ${auth.accessToken}`,
      "new-api-user": auth.userId,
      "User-Agent": NEW_API_USER_AGENT,
    };
  }

  private apiKeyHeaders(auth: NewApiKeyAuth): HeadersInit {
    return {
      Authorization: `Bearer ${auth.apiKey}`,
    };
  }
}
