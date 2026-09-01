import {
  buildUpstreamAutomationInitScript,
  buildUpstreamLoginUserScript,
} from "./upstream_login_userscript.ts";

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

async function waitUntil(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

const ORIGIN = "https://new-api.example";
const SESSION_KEY = "tts-upstream-login";
const PAT = "sk-test-pat";
const USER_ID = "7";
const USER = { id: 7, username: "alice", role: 1 };

interface NetworkCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  headerValues?: Record<string, string[]>;
  credentials?: RequestCredentials;
  body: string | null;
}

interface RouteResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface HarnessOptions {
  source?: string;
  hash?: string;
  storedSession?: unknown;
  logoutStatus?: number;
  logoutBody?: unknown;
  legacyLogoutStatus?: number;
  legacyLogoutBody?: unknown;
  selfStatus?: number;
  selfBody?: unknown;
  protocol?: "http:" | "https:";
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<() => void>>();
  readonly style: Record<string, string> & { cssText: string } = {
    cssText: "",
  };
  textContent = "";
  innerHTML = "";
  id = "";
  type = "";
  title = "";
  removed = false;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
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

interface FakeXhrLike {
  readonly readyState: number;
  readonly status: number;
  readonly statusText: string;
  readonly responseText: string;
  readonly response: unknown;
  responseType: XMLHttpRequestResponseType;
  timeout: number;
  withCredentials: boolean;
  onreadystatechange: (() => void) | null;
  onload: (() => void) | null;
  onloadend: (() => void) | null;
  onerror: (() => void) | null;
  open(method: string, url: string | URL, async?: boolean): void;
  setRequestHeader(name: string, value: string): void;
  addEventListener(type: string, listener: () => void): void;
  send(body?: Document | XMLHttpRequestBodyInit | null): void;
}

interface Harness {
  readonly origin: string;
  readonly sandbox: Record<string, unknown>;
  readonly fetchCalls: NetworkCall[];
  readonly xhrCalls: NetworkCall[];
  readonly historyCalls: Array<{
    url: string;
    networkCount: number;
    session: string | null;
  }>;
  readonly navigations: string[];
  readonly document: {
    body: FakeElement;
    documentElement: FakeElement;
  };
  readonly localStorage: Storage & { peek(key: string): string | null };
  readonly sessionStorage: Storage & { peek(key: string): string | null };
  getReloadCount(): number;
  getStopCount(): number;
  execute(): void;
  createXhr(): FakeXhrLike;
}

function activeSession(origin = ORIGIN): Record<string, unknown> {
  return {
    version: 1,
    phase: "active",
    origin,
    accessToken: PAT,
    userId: USER_ID,
    user: USER,
    tabNonce: "tab-nonce",
    createdAt: 1_700_000_000_000,
  };
}

function elementText(element: FakeElement): string {
  return [
    element.textContent,
    element.innerHTML,
    ...element.children.map(elementText),
  ].join(" ");
}

function findElement(
  root: FakeElement,
  predicate: (element: FakeElement) => boolean,
): FakeElement | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const protocol = options.protocol ?? "https:";
  const origin = `${protocol}//new-api.example`;
  const hash = options.hash ?? "";
  const initialUrl = `${origin}/dashboard?tab=quota${hash}`;
  const fetchCalls: NetworkCall[] = [];
  const xhrCalls: NetworkCall[] = [];
  const historyCalls: Harness["historyCalls"] = [];
  const navigations: string[] = [];
  let reloadCount = 0;
  let stopCount = 0;
  let currentUrl = new URL(initialUrl);

  class HarnessStorage implements Storage {
    readonly #values = new Map<string, string>();

    get length(): number {
      return this.#values.size;
    }

    clear(): void {
      this.#values.clear();
    }

    getItem(key: string): string | null {
      return this.#values.get(String(key)) ?? null;
    }

    key(index: number): string | null {
      return [...this.#values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
      this.#values.delete(String(key));
    }

    setItem(key: string, value: string): void {
      this.#values.set(String(key), String(value));
    }

    peek(key: string): string | null {
      return this.#values.get(String(key)) ?? null;
    }
  }

  const localStorage = new HarnessStorage();
  localStorage.setItem("user", JSON.stringify({ id: 99, username: "old" }));
  localStorage.setItem("uid", "99");
  localStorage.setItem("theme", "dark");
  const sessionStorage = new HarnessStorage();
  if (options.storedSession !== undefined) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(options.storedSession));
  }

  const location = {
    get href(): string {
      return currentUrl.href;
    },
    set href(value: string) {
      currentUrl = new URL(value, currentUrl);
      navigations.push(currentUrl.href);
    },
    get origin(): string {
      return currentUrl.origin;
    },
    get protocol(): string {
      return currentUrl.protocol;
    },
    get pathname(): string {
      return currentUrl.pathname;
    },
    get search(): string {
      return currentUrl.search;
    },
    get hash(): string {
      return currentUrl.hash;
    },
    assign(value: string): void {
      this.href = value;
    },
    replace(value: string): void {
      this.href = value;
    },
    reload(): void {
      reloadCount++;
    },
  };

  const document = {
    body: new FakeElement("body"),
    documentElement: new FakeElement("html"),
    readyState: "complete",
    title: "new-api",
    createElement(tagName: string): FakeElement {
      return new FakeElement(tagName);
    },
    addEventListener(_type: string, listener: () => void): void {
      queueMicrotask(listener);
    },
    open(): void {},
    close(): void {},
    write(html: string): void {
      this.body.innerHTML = html;
    },
  };

  function route(method: string, url: URL): RouteResult {
    if (url.pathname === "/api/user/auth/logout") {
      return {
        status: options.logoutStatus ?? 200,
        body: options.logoutBody ?? { success: true },
      };
    }
    if (url.pathname === "/api/user/logout") {
      return {
        status: options.legacyLogoutStatus ?? 200,
        body: options.legacyLogoutBody ?? { success: true },
      };
    }
    if (url.pathname === "/api/user/self") {
      return {
        status: options.selfStatus ?? 200,
        body: options.selfBody ?? { success: true, data: USER },
      };
    }
    if (url.pathname === "/api/user/auth/refresh") {
      return {
        status: 500,
        body: { success: false, message: "real refresh must not be called" },
      };
    }
    if (url.pathname === "/api/user/token") {
      return { status: 200, body: { success: true, data: "rotated-pat" } };
    }
    return {
      status: 200,
      body: { success: true, data: { method, path: url.pathname } },
    };
  }

  const nativeFetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), origin);
    const method = String(init.method ?? request?.method ?? "GET")
      .toUpperCase();
    const headers = init.headers !== undefined
      ? new Headers(init.headers)
      : new Headers(request?.headers);
    const credentials = init.credentials ?? request?.credentials;
    let body: string | null = null;
    if (init.body !== undefined && init.body !== null) {
      body = typeof init.body === "string" ? init.body : "[body]";
    } else if (request && request.body) {
      body = await request.clone().text();
    }
    fetchCalls.push({
      method,
      url: url.href,
      path: url.pathname,
      headers: Object.fromEntries(headers.entries()),
      credentials,
      body,
    });
    const result = route(method, url);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        ...(result.headers ?? {}),
      },
    });
  };

  class FakeXMLHttpRequest implements FakeXhrLike {
    #readyState = 0;
    #status = 0;
    #statusText = "";
    #responseText = "";
    #responseUrl = "";
    #method = "GET";
    #url = new URL(origin);
    #headers = new Map<string, { name: string; values: string[] }>();
    readonly #listeners = new Map<string, Array<() => void>>();
    responseType: XMLHttpRequestResponseType = "";
    timeout = 0;
    withCredentials = false;
    onreadystatechange: (() => void) | null = null;
    onload: (() => void) | null = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    get readyState(): number {
      return this.#readyState;
    }

    get status(): number {
      return this.#status;
    }

    get statusText(): string {
      return this.#statusText;
    }

    get responseText(): string {
      return this.#responseText;
    }

    get response(): unknown {
      if (this.responseType === "json") {
        try {
          return JSON.parse(this.#responseText);
        } catch {
          return null;
        }
      }
      return this.#responseText;
    }

    get responseURL(): string {
      return this.#responseUrl;
    }

    open(method: string, url: string | URL, _async = true): void {
      this.#method = String(method).toUpperCase();
      this.#url = new URL(String(url), origin);
      this.#headers.clear();
      this.#readyState = 1;
      this.#status = 0;
      this.#statusText = "";
      this.#responseText = "";
      this.#dispatch("readystatechange");
    }

    setRequestHeader(name: string, value: string): void {
      const normalized = name.toLowerCase();
      const entry = this.#headers.get(normalized) ?? { name, values: [] };
      entry.values.push(String(value));
      this.#headers.set(normalized, entry);
    }

    addEventListener(type: string, listener: () => void): void {
      const listeners = this.#listeners.get(type) ?? [];
      listeners.push(listener);
      this.#listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: () => void): void {
      const listeners = this.#listeners.get(type) ?? [];
      this.#listeners.set(type, listeners.filter((item) => item !== listener));
    }

    getAllResponseHeaders(): string {
      return "content-type: application/json\r\n";
    }

    getResponseHeader(name: string): string | null {
      return name.toLowerCase() === "content-type" ? "application/json" : null;
    }

    abort(): void {
      this.#readyState = 0;
    }

    send(body: Document | XMLHttpRequestBodyInit | null = null): void {
      const headerValues = Object.fromEntries(
        [...this.#headers.entries()].map(([name, value]) => [
          name,
          [...value.values],
        ]),
      );
      const headers = Object.fromEntries(
        Object.entries(headerValues).map(([name, values]) => [
          name,
          values.join(", "),
        ]),
      );
      xhrCalls.push({
        method: this.#method,
        url: this.#url.href,
        path: this.#url.pathname,
        headers,
        headerValues,
        credentials: this.withCredentials ? "include" : "same-origin",
        body: typeof body === "string" ? body : body === null ? null : "[body]",
      });

      queueMicrotask(() => {
        try {
          const result = route(this.#method, this.#url);
          this.#status = result.status;
          this.#statusText = result.status >= 200 && result.status < 300
            ? "OK"
            : "Error";
          this.#responseText = JSON.stringify(result.body);
          this.#responseUrl = this.#url.href;
          this.#readyState = 4;
          this.#dispatch("readystatechange");
          this.#dispatch("load");
          this.#dispatch("loadend");
        } catch {
          this.#dispatch("error");
          this.#dispatch("loadend");
        }
      });
    }

    #dispatch(type: string): void {
      const handler = this[`on${type}` as keyof FakeXMLHttpRequest];
      if (typeof handler === "function") handler.call(this);
      for (const listener of this.#listeners.get(type) ?? []) {
        listener.call(this);
      }
    }
  }

  const sandbox: Record<string, unknown> = {
    document,
    location,
    history: {
      replaceState(_data: unknown, _unused: string, url?: string | URL | null) {
        if (url === undefined || url === null) return;
        historyCalls.push({
          url: String(url),
          networkCount: fetchCalls.length + xhrCalls.length,
          session: sessionStorage.peek(SESSION_KEY),
        });
        currentUrl = new URL(String(url), currentUrl);
      },
    },
    localStorage,
    sessionStorage,
    Storage: HarnessStorage,
    fetch: nativeFetch,
    XMLHttpRequest: FakeXMLHttpRequest,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    navigator: { userAgent: "Chromium Test" },
    crypto,
    console,
    queueMicrotask,
    setTimeout(callback: () => void, delay = 0): number {
      if (delay < 1_000) queueMicrotask(callback);
      return 1;
    },
    clearTimeout(_id: number): void {},
    stop(): void {
      stopCount++;
    },
    opener: null,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.globalThis = sandbox;

  const source = options.source ?? buildUpstreamLoginUserScript({
    baseUrl: "https://tuntunshu.example",
  });
  const run = new Function(
    "sandbox",
    `with (sandbox) {\n${source}\n}`,
  ) as (sandbox: Record<string, unknown>) => void;

  return {
    origin,
    sandbox,
    fetchCalls,
    xhrCalls,
    historyCalls,
    navigations,
    document,
    localStorage,
    sessionStorage,
    getReloadCount: () => reloadCount,
    getStopCount: () => stopCount,
    execute() {
      run(sandbox);
    },
    createXhr() {
      const Xhr = sandbox.XMLHttpRequest as new () => FakeXhrLike;
      return new Xhr();
    },
  };
}

function readSession(harness: Harness): Record<string, unknown> | null {
  const value = harness.sessionStorage.getItem(SESSION_KEY);
  return value ? JSON.parse(value) as Record<string, unknown> : null;
}

async function sendXhr(xhr: FakeXhrLike): Promise<void> {
  const loaded = new Promise<void>((resolve) => {
    xhr.addEventListener("loadend", resolve);
  });
  xhr.send();
  await loaded;
}

Deno.test("upstream login userscript 元数据正确且普通页面保持惰性", async () => {
  const source = buildUpstreamLoginUserScript({
    baseUrl: "https://tuntunshu.example/",
  });
  for (
    const directive of [
      "// @version      1.0.0",
      "// @match        http://*/*",
      "// @match        https://*/*",
      "// @grant        none",
      "// @inject-into  page",
      "// @run-at       document-start",
      "// @noframes",
      "https://tuntunshu.example/tuntunshu-login.user.js",
    ]
  ) {
    assert(source.includes(directive), `missing metadata: ${directive}`);
  }

  const harness = createHarness();
  const originalFetch = harness.sandbox.fetch;
  const Xhr = harness.sandbox.XMLHttpRequest as { prototype: object };
  const originalOpen = Object.getOwnPropertyDescriptor(Xhr.prototype, "open")
    ?.value;
  harness.execute();
  await settle();

  assertEquals(
    harness.sandbox.__TTS_UPSTREAM_LOGIN_SCRIPT__,
    "1.0.0",
    "script marker mismatch",
  );
  assert(harness.sandbox.fetch === originalFetch, "inert page patched fetch");
  assert(
    Object.getOwnPropertyDescriptor(Xhr.prototype, "open")?.value ===
      originalOpen,
    "inert page patched XMLHttpRequest",
  );
  assertEquals(harness.fetchCalls, [], "inert page made a request");
  assertEquals(harness.xhrCalls, [], "inert page made an XHR request");
  assertEquals(
    harness.sessionStorage.getItem(SESSION_KEY),
    null,
    "inert page created login state",
  );
});

Deno.test("upstream login userscript 同步清理 fragment 并完成两阶段启动", async () => {
  const fragment = "#__tts_upstream_login__?" + new URLSearchParams({
    accessToken: PAT,
    userId: USER_ID,
  });
  const harness = createHarness({ hash: fragment });

  harness.execute();
  const pending = readSession(harness);
  assertEquals(pending?.phase, "pending", "first phase was not persisted");
  assertEquals(
    pending?.origin,
    harness.origin,
    "real origin was not persisted",
  );
  assertEquals(pending?.accessToken, PAT, "PAT was not persisted exactly");
  assertEquals(harness.historyCalls.length, 1, "fragment was not cleared once");
  assertEquals(
    harness.historyCalls[0].networkCount,
    0,
    "network request started before fragment cleanup",
  );
  assert(
    !harness.historyCalls[0].url.includes("accessToken"),
    "clean URL retained the PAT",
  );
  assertEquals(harness.getStopCount(), 1, "page startup was not stopped");

  await waitUntil(
    () => harness.getReloadCount() === 1,
    "validated login did not reload",
  );
  const active = readSession(harness);
  assertEquals(active?.phase, "active", "login did not become active");
  assertEquals(active?.user, USER, "verified user was not persisted");
  assert(
    typeof active?.tabNonce === "string" && active.tabNonce.length > 0,
    "tab nonce was not generated",
  );
  assertEquals(
    harness.fetchCalls.map((call) => [call.method, call.path]),
    [
      ["POST", "/api/user/auth/logout"],
      ["GET", "/api/user/self"],
    ],
    "startup request order mismatch",
  );
  assertEquals(
    harness.fetchCalls[0].credentials,
    "include",
    "logout must include the old session cookie",
  );
  assert(
    !harness.fetchCalls[0].headers.authorization,
    "logout leaked the new PAT",
  );
  assertEquals(
    harness.fetchCalls[1].headers.authorization,
    `Bearer ${PAT}`,
    "self validation did not use the PAT",
  );
  assertEquals(
    harness.fetchCalls[1].headers["new-api-user"],
    USER_ID,
    "self validation did not use New-Api-User",
  );
  assertEquals(
    harness.fetchCalls[1].credentials,
    "omit",
    "self validation must exclude cookies",
  );
  assertEquals(
    harness.localStorage.peek("user"),
    null,
    "old shared user was not removed",
  );
  assertEquals(
    harness.localStorage.peek("uid"),
    null,
    "old shared uid was not removed",
  );
});

Deno.test("upstream login userscript 仅在新版 logout 不存在时回退旧版", async () => {
  const fragment = "#__tts_upstream_login__?accessToken=pat&userId=7";
  const harness = createHarness({ hash: fragment, logoutStatus: 404 });
  harness.execute();
  await waitUntil(() => harness.getReloadCount() === 1, "legacy flow failed");

  assertEquals(
    harness.fetchCalls.map((call) => [call.method, call.path]),
    [
      ["POST", "/api/user/auth/logout"],
      ["GET", "/api/user/logout"],
      ["GET", "/api/user/self"],
    ],
    "legacy logout fallback mismatch",
  );
  assert(
    harness.fetchCalls.slice(0, 2).every((call) =>
      call.credentials === "include" && !call.headers.authorization
    ),
    "logout fallback must use cookies without PAT",
  );
});

Deno.test("upstream login userscript logout 或 self 校验失败时 fail closed", async () => {
  const fragment = "#__tts_upstream_login__?accessToken=pat&userId=7";
  const logoutFailure = createHarness({ hash: fragment, logoutStatus: 500 });
  logoutFailure.execute();
  await settle();
  assertEquals(logoutFailure.getReloadCount(), 0, "failed logout reloaded");
  assertEquals(
    logoutFailure.fetchCalls.map((call) => call.path),
    ["/api/user/auth/logout"],
    "failed logout continued to self validation",
  );
  assertEquals(
    logoutFailure.sessionStorage.getItem(SESSION_KEY),
    null,
    "failed logout retained credentials",
  );

  const nonJsonLogout = createHarness({
    hash: fragment,
    logoutBody: "<!doctype html>not an API response",
  });
  nonJsonLogout.execute();
  await settle();
  assertEquals(
    nonJsonLogout.fetchCalls.map((call) => call.path),
    ["/api/user/auth/logout"],
    "non-JSON logout response was incorrectly accepted",
  );
  assertEquals(
    nonJsonLogout.sessionStorage.getItem(SESSION_KEY),
    null,
    "non-JSON logout response retained credentials",
  );

  const mismatch = createHarness({
    hash: fragment,
    selfBody: { success: true, data: { ...USER, id: 8 } },
  });
  mismatch.execute();
  await settle();
  assertEquals(mismatch.getReloadCount(), 0, "mismatched user reloaded");
  assertEquals(
    mismatch.sessionStorage.getItem(SESSION_KEY),
    null,
    "mismatched user retained credentials",
  );
  assert(
    elementText(mismatch.document.body).includes("失败") ||
      elementText(mismatch.document.documentElement).includes("失败"),
    "validation failure did not render an error",
  );
});

Deno.test("upstream login userscript active 模式隔离旧版 Storage 并限制 fetch 注入范围", async () => {
  const harness = createHarness({ storedSession: activeSession() });
  harness.execute();
  await settle();

  assertEquals(
    harness.localStorage.getItem("user"),
    JSON.stringify(USER),
    "legacy user shadow mismatch",
  );
  assertEquals(
    harness.localStorage.getItem("uid"),
    USER_ID,
    "legacy uid shadow mismatch",
  );
  const updatedUser = { ...USER, username: "alice-updated" };
  harness.localStorage.setItem("user", JSON.stringify(updatedUser));
  harness.localStorage.setItem("uid", USER_ID);
  harness.localStorage.setItem("theme", "light");
  assertEquals(
    harness.localStorage.getItem("user"),
    JSON.stringify(updatedUser),
    "legacy user write did not stay in shadow",
  );
  assertEquals(
    harness.localStorage.peek("user"),
    JSON.stringify({ id: 99, username: "old" }),
    "legacy user write reached shared localStorage",
  );
  assertEquals(
    harness.localStorage.peek("theme"),
    "light",
    "unrelated localStorage key was not delegated",
  );

  const patchedFetch = harness.sandbox.fetch as typeof fetch;
  await patchedFetch("/api/items", {
    headers: {
      Authorization: "Bearer page-token",
      "New-Api-User": "99",
      "X-Test": "same-origin",
    },
  });
  await patchedFetch(`${harness.origin}/v1/models`, {
    headers: { Authorization: "Bearer v1-token" },
  });
  await patchedFetch("https://outside.example/api/items", {
    headers: { Authorization: "Bearer outside-token" },
  });
  const controller = new AbortController();
  const request = new Request(`${harness.origin}/api/request`, {
    method: "POST",
    headers: { Authorization: "Bearer request-token", "X-From": "request" },
    body: "payload",
    signal: controller.signal,
  });
  await patchedFetch(request);

  const apiCall = harness.fetchCalls.find((call) => call.path === "/api/items");
  assert(apiCall, "same-origin API request did not reach native fetch");
  assertEquals(
    apiCall.headers.authorization,
    `Bearer ${PAT}`,
    "same-origin Authorization was not replaced",
  );
  assertEquals(
    apiCall.headers["new-api-user"],
    USER_ID,
    "same-origin New-Api-User was not replaced",
  );
  assertEquals(apiCall.credentials, "omit", "API cookies were not omitted");

  const v1Call = harness.fetchCalls.find((call) => call.path === "/v1/models");
  assertEquals(
    v1Call?.headers.authorization,
    "Bearer v1-token",
    "/v1 request was modified",
  );
  assert(
    !v1Call?.headers["new-api-user"],
    "/v1 request received New-Api-User",
  );
  const outsideCall = harness.fetchCalls.find((call) =>
    call.url.startsWith("https://outside.example/")
  );
  assertEquals(
    outsideCall?.headers.authorization,
    "Bearer outside-token",
    "cross-origin request was modified",
  );
  assert(
    !outsideCall?.headers["new-api-user"],
    "cross-origin request leaked New-Api-User",
  );
  const requestCall = harness.fetchCalls.find((call) =>
    call.path === "/api/request"
  );
  assertEquals(requestCall?.method, "POST", "Request method was lost");
  assertEquals(requestCall?.body, "payload", "Request body was lost");
  assertEquals(
    requestCall?.headers["x-from"],
    "request",
    "Request headers were lost",
  );
  controller.abort();

  harness.localStorage.removeItem("user");
  assertEquals(
    harness.sessionStorage.getItem(SESSION_KEY),
    null,
    "legacy auth reset revived the PAT session on the next reload",
  );
});

Deno.test("upstream login userscript fetch 虚拟新版 AuthBundle 且阻止 PAT 轮换", async () => {
  const harness = createHarness({ storedSession: activeSession() });
  harness.execute();
  await settle();
  const patchedFetch = harness.sandbox.fetch as typeof fetch;

  const refresh = await patchedFetch("/api/user/auth/refresh", {
    method: "POST",
  });
  const body = await refresh.json();
  const data = (body as { data: Record<string, unknown> }).data;
  assertEquals(data.access_token, PAT, "AuthBundle rotated the PAT");
  assertEquals(
    data.access_expires_at,
    253402300799,
    "AuthBundle access expiry mismatch",
  );
  assertEquals(data.user, USER, "AuthBundle did not use verified user");
  const session = data.session as Record<string, unknown>;
  assertEquals(
    session.sid,
    "tts-pat:tab-nonce",
    "session placeholder sid mismatch",
  );
  assertEquals(
    session.expires_at,
    253402300799,
    "session placeholder expiry mismatch",
  );
  assertEquals(
    harness.fetchCalls.filter((call) => call.path === "/api/user/auth/refresh")
      .length,
    0,
    "real refresh endpoint was called",
  );
  assertEquals(
    harness.fetchCalls.filter((call) => call.path === "/api/user/self").length,
    1,
    "virtual refresh did not revalidate the PAT once",
  );

  const tokenCallCount = harness.fetchCalls.length;
  const blocked = await patchedFetch("/api/user/token");
  assert(!blocked.ok, "PAT rotation was not rejected");
  assertEquals(
    harness.fetchCalls.length,
    tokenCallCount,
    "blocked PAT rotation reached native fetch",
  );
  assert(
    JSON.stringify(await blocked.json()).includes("PAT"),
    "blocked PAT rotation lacked an explicit error",
  );
});

Deno.test("upstream login userscript XHR 覆盖鉴权、虚拟 refresh 并阻止 PAT 轮换", async () => {
  const harness = createHarness({ storedSession: activeSession() });
  harness.execute();
  await settle();

  const xhr = harness.createXhr();
  xhr.open("GET", "/api/items");
  xhr.setRequestHeader("Authorization", "Bearer page-token");
  xhr.setRequestHeader("Authorization", "Bearer second-page-token");
  xhr.setRequestHeader("New-Api-User", "99");
  await sendXhr(xhr);
  xhr.open("GET", "/api/items-again");
  xhr.setRequestHeader("Authorization", "Bearer stale-token");
  await sendXhr(xhr);

  for (const call of harness.xhrCalls.slice(0, 2)) {
    assertEquals(
      call.headerValues?.authorization,
      [`Bearer ${PAT}`],
      "XHR Authorization was appended or duplicated",
    );
    assertEquals(
      call.headerValues?.["new-api-user"],
      [USER_ID],
      "XHR New-Api-User was missing or duplicated",
    );
  }

  const v1Xhr = harness.createXhr();
  v1Xhr.open("GET", "/v1/models");
  v1Xhr.setRequestHeader("Authorization", "Bearer relay-key");
  await sendXhr(v1Xhr);
  const v1Call = harness.xhrCalls.at(-1);
  assertEquals(
    v1Call?.headers.authorization,
    "Bearer relay-key",
    "XHR /v1 request was modified",
  );
  assert(!v1Call?.headers["new-api-user"], "XHR /v1 leaked user id");

  const externalXhr = harness.createXhr();
  externalXhr.open("GET", "https://outside.example/api/items");
  externalXhr.setRequestHeader("Authorization", "Bearer external-key");
  await sendXhr(externalXhr);
  const externalCall = harness.xhrCalls.at(-1);
  assertEquals(
    externalCall?.headers.authorization,
    "Bearer external-key",
    "cross-origin XHR was modified",
  );
  assert(
    !externalCall?.headers["new-api-user"],
    "cross-origin XHR leaked user id",
  );

  const refreshXhr = harness.createXhr();
  refreshXhr.open("POST", "/api/user/auth/refresh");
  refreshXhr.responseType = "json";
  refreshXhr.timeout = 12_345;
  await sendXhr(refreshXhr);
  const refreshBody = refreshXhr.response as {
    success: boolean;
    data: {
      access_token: string;
      access_expires_at: number;
      session: { sid: string; expires_at: number };
    };
  };
  assert(refreshBody.success, "XHR refresh did not return success");
  assertEquals(
    refreshBody.data.access_token,
    PAT,
    "XHR refresh rotated PAT",
  );
  assertEquals(
    refreshBody.data.access_expires_at,
    253402300799,
    "XHR refresh access expiry mismatch",
  );
  assertEquals(
    refreshBody.data.session.sid,
    "tts-pat:tab-nonce",
    "XHR refresh session placeholder mismatch",
  );
  assertEquals(refreshXhr.timeout, 12_345, "XHR refresh lost timeout");
  assert(
    !harness.xhrCalls.some((call) => call.path === "/api/user/auth/refresh"),
    "XHR reached real refresh endpoint",
  );

  const beforeToken = harness.xhrCalls.length;
  const tokenXhr = harness.createXhr();
  tokenXhr.open("GET", "/api/user/token");
  await sendXhr(tokenXhr);
  assert(tokenXhr.status >= 400, "XHR PAT rotation was not rejected");
  assertEquals(
    harness.xhrCalls.length,
    beforeToken,
    "blocked XHR PAT rotation reached the network",
  );
  assert(
    tokenXhr.responseText.includes("PAT"),
    "blocked XHR PAT rotation lacked an explicit error",
  );
});

Deno.test("upstream login userscript logout 后停用补丁且不发送占位 Session", async () => {
  const fetchHarness = createHarness({ storedSession: activeSession() });
  fetchHarness.execute();
  await settle();
  const patchedFetch = fetchHarness.sandbox.fetch as typeof fetch;
  await patchedFetch("/api/user/auth/logout", {
    method: "POST",
    headers: {
      Authorization: "Bearer stale-dashboard-token",
      "New-Api-User": "99",
      "X-Auth-Session": "tts-pat:tab-nonce",
    },
  });
  const fetchLogout = fetchHarness.fetchCalls.at(-1);
  assertEquals(fetchLogout?.credentials, "include", "logout omitted cookies");
  assert(!fetchLogout?.headers.authorization, "logout leaked the PAT");
  assert(!fetchLogout?.headers["new-api-user"], "logout leaked user id");
  assert(
    !fetchLogout?.headers["x-auth-session"],
    "logout sent the frontend-only Session placeholder",
  );
  assertEquals(
    fetchHarness.sessionStorage.getItem(SESSION_KEY),
    null,
    "logout retained the PAT session",
  );

  await patchedFetch("/api/after-logout", {
    headers: { Authorization: "Bearer normal-login" },
  });
  const fetchAfter = fetchHarness.fetchCalls.at(-1);
  assertEquals(
    fetchAfter?.headers.authorization,
    "Bearer normal-login",
    "disabled fetch wrapper revived the old PAT",
  );
  assert(
    !fetchAfter?.headers["new-api-user"],
    "disabled fetch wrapper injected the old user id",
  );

  const xhrHarness = createHarness({ storedSession: activeSession() });
  xhrHarness.execute();
  await settle();
  const logoutXhr = xhrHarness.createXhr();
  logoutXhr.open("POST", "/api/user/auth/logout");
  logoutXhr.setRequestHeader("Authorization", "Bearer stale-dashboard-token");
  logoutXhr.setRequestHeader("New-Api-User", "99");
  logoutXhr.setRequestHeader("X-Auth-Session", "tts-pat:tab-nonce");
  await sendXhr(logoutXhr);
  const xhrLogout = xhrHarness.xhrCalls.at(-1);
  assert(!xhrLogout?.headers.authorization, "XHR logout leaked the PAT");
  assert(!xhrLogout?.headers["new-api-user"], "XHR logout leaked user id");
  assert(
    !xhrLogout?.headers["x-auth-session"],
    "XHR logout sent the frontend-only Session placeholder",
  );

  const afterXhr = xhrHarness.createXhr();
  afterXhr.open("GET", "/api/after-logout");
  afterXhr.setRequestHeader("Authorization", "Bearer normal-login");
  await sendXhr(afterXhr);
  const xhrAfter = xhrHarness.xhrCalls.at(-1);
  assertEquals(
    xhrAfter?.headers.authorization,
    "Bearer normal-login",
    "disabled XHR wrapper revived the old PAT",
  );
  assert(
    !xhrAfter?.headers["new-api-user"],
    "disabled XHR wrapper injected the old user id",
  );

  const clearHarness = createHarness({ storedSession: activeSession() });
  clearHarness.execute();
  await settle();
  clearHarness.localStorage.clear();
  assertEquals(
    clearHarness.sessionStorage.getItem(SESSION_KEY),
    null,
    "localStorage.clear retained the PAT session",
  );
});

Deno.test("upstream login userscript XHR refresh 失败时主动停用免登", async () => {
  const harness = createHarness({
    storedSession: activeSession(),
    selfStatus: 401,
    selfBody: { success: false, message: "expired" },
  });
  harness.execute();
  await settle();

  const xhr = harness.createXhr();
  xhr.open("POST", "/api/user/auth/refresh");
  await sendXhr(xhr);
  assertEquals(
    harness.sessionStorage.getItem(SESSION_KEY),
    null,
    "failed XHR refresh retained the PAT session without reading its body",
  );
});

Deno.test("upstream login userscript 浮条展示限制并清理退出状态", async () => {
  const harness = createHarness({
    storedSession: activeSession("http://new-api.example"),
    protocol: "http:",
  });
  harness.execute();
  await settle();

  const pageText = elementText(harness.document.body);
  assert(pageText.includes("囤囤鼠 PAT 免登"), "login banner was not rendered");
  assert(pageText.includes("alice") && pageText.includes("#7"), "user missing");
  assert(
    pageText.includes("Session") && pageText.includes("Passkey"),
    "session-only limitations were not disclosed",
  );
  assert(
    pageText.includes("HTTP") || pageText.includes("明文"),
    "HTTP warning missing",
  );

  const exit = findElement(
    harness.document.body,
    (element) =>
      element.tagName.toLowerCase() === "button" &&
      elementText(element).includes("退出"),
  );
  assert(exit, "login banner exit button missing");
  exit.dispatch("click");
  await waitUntil(
    () => harness.navigations.some((url) => new URL(url).pathname === "/login"),
    "exit did not navigate to the cross-version login path",
  );
  assertEquals(
    harness.sessionStorage.getItem(SESSION_KEY),
    null,
    "exit retained login credentials",
  );
  const logout = harness.fetchCalls.find((call) =>
    call.path === "/api/user/auth/logout"
  );
  assert(logout, "exit did not attempt logout");
  assertEquals(logout.credentials, "include", "exit logout omitted cookies");
  assert(!logout.headers.authorization, "exit logout leaked the PAT");
});

Deno.test("upstream automation bootstrap keeps PAT out of URL and Storage", async () => {
  const source = buildUpstreamAutomationInitScript({
    origin: ORIGIN,
    accessToken: PAT,
    userId: USER_ID,
    user: USER,
    tabNonce: "automation-nonce",
    createdAt: 1_700_000_000_000,
  });
  const harness = createHarness({ source });
  harness.sandbox.WebSocket = function () {};
  harness.sandbox.Worker = function () {};
  harness.sandbox.SharedWorker = function () {};
  harness.sandbox.WebTransport = function () {};
  harness.sandbox.RTCPeerConnection = function () {};
  harness.sandbox.webkitRTCPeerConnection = function () {};

  harness.execute();
  await settle();

  assertEquals(
    harness.sandbox.__TTS_UPSTREAM_LOGIN_SCRIPT__,
    "1.0.0",
    "automation runtime marker mismatch",
  );
  for (
    const name of [
      "WebSocket",
      "Worker",
      "SharedWorker",
      "WebTransport",
      "RTCPeerConnection",
      "webkitRTCPeerConnection",
    ]
  ) {
    assertEquals(
      harness.sandbox[name],
      undefined,
      `automation left ${name} available`,
    );
  }
  assertEquals(
    harness.sessionStorage.peek(SESSION_KEY),
    null,
    "automation persisted an active session",
  );
  assertEquals(
    harness.localStorage.peek("user"),
    null,
    "automation persisted the shadow user",
  );
  assertEquals(
    harness.localStorage.peek("uid"),
    null,
    "automation persisted the shadow uid",
  );
  assert(
    !String((harness.sandbox.location as { href?: string }).href ?? "")
      .includes(
        PAT,
      ),
    "automation put the PAT in the page URL",
  );

  const patchedFetch = harness.sandbox.fetch as typeof fetch;
  const refresh = await patchedFetch("/api/user/auth/refresh");
  const bundle = await refresh.json() as {
    data?: { access_token?: string };
  };
  assertEquals(bundle.data?.access_token, PAT, "virtual refresh lost the PAT");
  assertEquals(
    harness.sessionStorage.peek(SESSION_KEY),
    null,
    "virtual refresh persisted automation credentials",
  );
  assertEquals(
    harness.fetchCalls.at(-1)?.credentials,
    "include",
    "automation self refresh did not preserve Cloudflare cookies",
  );
  harness.localStorage.setItem("auth-cache", JSON.stringify({ token: PAT }));
  harness.sessionStorage.setItem("session-cache", PAT);
  assertEquals(
    harness.localStorage.peek("auth-cache"),
    null,
    "page code persisted the automation PAT in localStorage",
  );
  assertEquals(
    harness.sessionStorage.peek("session-cache"),
    null,
    "page code persisted the automation PAT in sessionStorage",
  );

  const persisted = JSON.stringify({
    history: harness.historyCalls,
    navigations: harness.navigations,
    localUser: harness.localStorage.peek("user"),
    localUid: harness.localStorage.peek("uid"),
    session: harness.sessionStorage.peek(SESSION_KEY),
  });
  assert(
    !persisted.includes(PAT),
    "automation PAT leaked into persisted state",
  );
});
