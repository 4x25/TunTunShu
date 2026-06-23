export interface NewApiUserAuth {
  origin: string;
  userId: string;
  accessToken: string;
}

export interface NewApiKeyAuth {
  origin: string;
  apiKey: string;
}

export class NewApiAdapter {
  async healthCheck(origin: string): Promise<Response> {
    return await fetch(`${origin}/`);
  }

  async checkin(auth: NewApiUserAuth): Promise<Response> {
    return await fetch(`${auth.origin}/api/user/checkin`, {
      method: "POST",
      headers: this.userHeaders(auth),
    });
  }

  async getCheckinStatus(auth: NewApiUserAuth): Promise<Response> {
    return await fetch(`${auth.origin}/api/user/checkin`, {
      headers: this.userHeaders(auth),
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
    size = 20,
  ): Promise<Response> {
    return await fetch(`${auth.origin}/api/token/?p=${page}&size=${size}`, {
      headers: this.userHeaders(auth),
    });
  }

  async getTokenKey(auth: NewApiUserAuth, tokenId: number): Promise<Response> {
    return await fetch(`${auth.origin}/api/token/${tokenId}/key`, {
      method: "POST",
      headers: this.userHeaders(auth),
    });
  }

  async getModels(auth: NewApiKeyAuth): Promise<Response> {
    return await fetch(`${auth.origin}/v1/models`, {
      headers: this.apiKeyHeaders(auth),
    });
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
    };
  }

  private apiKeyHeaders(auth: NewApiKeyAuth): HeadersInit {
    return {
      Authorization: `Bearer ${auth.apiKey}`,
    };
  }
}
