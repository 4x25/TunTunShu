import { buildUserScript } from "./userscript.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: ${a} !== ${b}`);
}

interface BrowserCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

interface GmRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  onload: (response: { status: number; responseText: string }) => void;
  onerror: () => void;
  ontimeout: () => void;
}

interface ScenarioOptions {
  localUser?: string | null;
  legacyStatus?: number;
  legacyUserId?: number;
  modernUserId?: number;
  existing?: boolean;
  confirmResult?: boolean;
  tokenTotal?: number;
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<() => void>>();
  readonly style: Record<string, string> = {};
  disabled = false;
  textContent = "";
  title = "";
  type = "";
  removed = false;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  remove(): void {
    this.removed = true;
  }
}

interface Harness {
  browserCalls: BrowserCall[];
  ttsCalls: BrowserCall[];
  lockNames: string[];
  getConfirmCount: () => number;
  click: () => Promise<void>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function createHarness(options: ScenarioOptions = {}): Promise<Harness> {
  const origin = "https://new-api.example";
  const legacyUserId = options.legacyUserId ?? 7;
  const modernUserId = options.modernUserId ?? 9;
  const dashboardToken = "dashboard-short-lived";
  const generatedPat = "pat-long-lived";
  const browserCalls: BrowserCall[] = [];
  const ttsCalls: BrowserCall[] = [];
  const lockNames: string[] = [];
  const created: FakeElement[] = [];
  let confirmCount = 0;

  const document = {
    body: new FakeElement("body"),
    readyState: "complete",
    createElement(tagName: string) {
      const element = new FakeElement(tagName);
      created.push(element);
      return element;
    },
    addEventListener(_type: string, _listener: () => void) {},
  };
  const localStorage = {
    getItem(key: string): string | null {
      return key === "user" ? (options.localUser ?? null) : null;
    },
  };
  const navigator = {
    locks: {
      request<T>(name: string, callback: () => Promise<T>): Promise<T> {
        lockNames.push(name);
        return callback();
      },
    },
  };

  const fetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    await Promise.resolve();
    const path = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.pathname + input.search
      : new URL(input.url).pathname;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body: unknown = null;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    browserCalls.push({
      method: init.method ?? "GET",
      path,
      headers,
      body,
    });

    if (path === "/api/status") {
      return jsonResponse({
        data: { system_name: "new-api", version: "latest", start_time: 1 },
      });
    }
    if (path === "/api/user/self") {
      const status = options.legacyStatus ?? 200;
      if (status !== 200) {
        return jsonResponse(
          { success: false, message: "Unauthorized" },
          status,
        );
      }
      return jsonResponse({
        success: true,
        data: { id: legacyUserId, username: "legacy" },
      });
    }
    if (path === "/api/user/auth/refresh") {
      return jsonResponse({
        success: true,
        data: {
          user: { id: modernUserId, username: "modern" },
          access_token: dashboardToken,
          access_expires_at: 4_102_444_800,
          session: { sid: "session" },
        },
      });
    }
    if (path === "/api/user/token") {
      return jsonResponse({ success: true, data: generatedPat });
    }
    if (path === "/api/token/?p=1&page_size=10") {
      const total = options.tokenTotal ?? 1;
      return jsonResponse({ success: true, data: { total, items: [] } });
    }
    if (path === "/api/user/self/groups") {
      return jsonResponse({
        success: true,
        data: { default: { desc: "default", ratio: 1 } },
      });
    }
    if (path === "/api/token/" && init.method === "POST") {
      return jsonResponse({ success: true, data: { id: 99 } });
    }
    throw new Error(
      `unexpected new-api request: ${init.method ?? "GET"} ${path}`,
    );
  };

  const gmXmlHttpRequest = (request: GmRequest): void => {
    const url = new URL(request.url);
    let body: unknown = null;
    if (request.data) body = JSON.parse(request.data);
    const call = {
      method: request.method,
      path: url.pathname,
      headers: request.headers ?? {},
      body,
    };
    ttsCalls.push(call);

    let responseBody: unknown;
    if (call.method === "GET" && call.path === "/api/sites") {
      responseBody = options.existing ? [{ id: 11, origin }] : [];
    } else if (call.method === "GET" && call.path === "/api/accounts") {
      const userId = options.localUser && (options.legacyStatus ?? 200) === 200
        ? legacyUserId
        : modernUserId;
      responseBody = options.existing
        ? [{ id: 22, site_id: 11, user_id: String(userId) }]
        : [];
    } else if (call.method === "POST" && call.path === "/api/sites") {
      responseBody = { success: true, id: 11, updated: false };
    } else if (call.method === "POST" && call.path === "/api/accounts") {
      responseBody = { success: true, id: 22, updated: false };
    } else if (
      call.method === "POST" &&
      call.path === "/api/accounts/22/checkin"
    ) {
      responseBody = { ok: true, checkinStatus: "checked" };
    } else {
      throw new Error(
        `unexpected TunTunShu request: ${call.method} ${call.path}`,
      );
    }

    queueMicrotask(() => {
      request.onload({
        status: 200,
        responseText: JSON.stringify(responseBody),
      });
    });
  };

  const fakeSetTimeout = (callback: () => void, _delay?: number): number => {
    queueMicrotask(callback);
    return 1;
  };
  const confirm = (_message: string): boolean => {
    confirmCount++;
    return options.confirmResult ?? true;
  };

  const source = buildUserScript({
    baseUrl: "https://tuntunshu.example",
    authKey: "tts-secret",
  });
  const execute = new Function(
    "document",
    "localStorage",
    "location",
    "navigator",
    "fetch",
    "GM_xmlhttpRequest",
    "confirm",
    "setTimeout",
    source,
  ) as (...args: unknown[]) => void;
  execute(
    document,
    localStorage,
    { origin },
    navigator,
    fetch,
    gmXmlHttpRequest,
    confirm,
    fakeSetTimeout,
  );

  await waitUntil(
    () =>
      ttsCalls.some((call) =>
        call.method === "GET" && call.path === "/api/sites"
      ),
    "userscript did not finish its initial recorded-state lookup",
  );
  await settle();
  const button = created.find((element) => element.tagName === "button");
  assert(button, "userscript did not render its button");

  return {
    browserCalls,
    ttsCalls,
    lockNames,
    getConfirmCount: () => confirmCount,
    async click() {
      button.dispatch("click");
      await waitUntil(
        () =>
          ttsCalls.some((call) =>
            call.method === "POST" && call.path === "/api/accounts"
          ) || confirmCount > 0 && options.confirmResult === false,
        "userscript click flow did not finish",
      );
      await settle();
    },
  };
}

Deno.test("userscript 优先使用有效的旧版 localStorage 登录态", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
  });
  await harness.click();

  assert(
    !harness.browserCalls.some((call) =>
      call.path === "/api/user/auth/refresh"
    ),
    "valid legacy auth must not call the modern refresh endpoint",
  );
  const protectedCalls = harness.browserCalls.filter((call) =>
    call.path !== "/api/status"
  );
  assert(
    protectedCalls.every((call) => !call.headers.authorization),
    "legacy requests must not carry a dashboard bearer token",
  );
  assert(
    protectedCalls.every((call) => call.headers["new-api-user"] === "7"),
    "legacy requests must carry New-Api-User",
  );
});

Deno.test("userscript 本地用户缺失时使用新版 refresh 与 Bearer", async () => {
  const harness = await createHarness({ localUser: null, tokenTotal: 0 });
  await harness.click();

  assert(
    harness.browserCalls.some((call) => call.path === "/api/user/auth/refresh"),
    "missing local user must call refresh",
  );
  assertEquals(
    harness.lockNames,
    ["new-api:auth-refresh", "new-api:auth-refresh"],
    "page load and click should coordinate refresh with the new-api Web Lock",
  );
  const bearerCalls = harness.browserCalls.filter((call) =>
    call.path === "/api/user/token" || call.path.startsWith("/api/token/") ||
    call.path === "/api/user/self/groups"
  );
  assert(
    bearerCalls.length >= 3 &&
      bearerCalls.every((call) =>
        call.headers.authorization === "Bearer dashboard-short-lived"
      ),
    "modern protected requests must carry the dashboard bearer token",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assert(accountWrite, "account write was not sent to TunTunShu");
  assertEquals(
    accountWrite.body,
    { siteId: 11, userId: "9", accessToken: "pat-long-lived" },
    "TunTunShu must receive only the generated long-lived PAT",
  );
});

Deno.test("userscript 旧登录态返回 401 时切换到新版鉴权", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "stale" }),
    legacyStatus: 401,
  });
  await harness.click();

  const selfIndex = harness.browserCalls.findIndex((call) =>
    call.path === "/api/user/self"
  );
  const refreshIndex = harness.browserCalls.findIndex((call) =>
    call.path === "/api/user/auth/refresh"
  );
  assert(selfIndex >= 0, "legacy auth was not attempted");
  assert(
    refreshIndex > selfIndex,
    "modern refresh must happen only after legacy auth is rejected",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assert(accountWrite, "fallback flow did not save the account");
  assertEquals(
    accountWrite.body,
    { siteId: 11, userId: "9", accessToken: "pat-long-lived" },
    "fallback flow must save the modern authenticated user",
  );
});

Deno.test("userscript 无效 localStorage 数据直接走新版鉴权", async () => {
  for (
    const localUser of [
      "{broken-json",
      JSON.stringify({ username: "missing-id" }),
    ]
  ) {
    const harness = await createHarness({ localUser });
    await harness.click();

    assert(
      !harness.browserCalls.some((call) => call.path === "/api/user/self"),
      "invalid localStorage data must not be used as legacy auth",
    );
    assert(
      harness.browserCalls.some((call) =>
        call.path === "/api/user/auth/refresh"
      ),
      "invalid localStorage data must fall back to modern refresh",
    );
  }
});

Deno.test("userscript 已录入取消后不生成 PAT 或执行写操作", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
    existing: true,
    confirmResult: false,
  });
  await harness.click();

  assertEquals(harness.getConfirmCount(), 1, "existing account must ask once");
  assert(
    !harness.browserCalls.some((call) => call.path === "/api/user/token"),
    "cancelled flow must not regenerate the PAT",
  );
  assert(
    !harness.ttsCalls.some((call) => call.method === "POST"),
    "cancelled flow must not write to TunTunShu",
  );
});

Deno.test("userscript 版本升级且生成结果保持可执行", () => {
  const source = buildUserScript({
    baseUrl: "https://tuntunshu.example",
    authKey: 'quote"key',
  });
  assert(source.includes("// @version      1.3.2"), "version was not bumped");
  new Function(source);
});
