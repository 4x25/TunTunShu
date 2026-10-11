import { buildUserScript } from "./userscript.ts";

// 与脚本内 PAT_SCOPES 保持一致(完整个人域)。
const PAT_SCOPES = [
  "profile:read",
  "profile:write",
  "api_key:read",
  "api_key:write",
  "api_key:reveal",
  "wallet:read",
  "wallet:write",
  "usage:read",
  "account_security:read",
];

function bodyOf(call: BrowserCall | undefined): Record<string, unknown> {
  return (call?.body ?? {}) as Record<string, unknown>;
}

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
  query?: Record<string, string>;
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
  existingPage?: number;
  confirmResult?: boolean;
  tokenTotal?: number;
  capsulePos?: { left: number; top: number };
  /** 上游为新版(≥ rc.41):GET/POST /api/user/access_tokens 可用。 */
  scopedSupport?: boolean;
  /** 已录入账号里保存的 access token(TTS 列表接口原样返回)。 */
  storedAccountToken?: string | null;
  /** GET /api/user/access_tokens 返回的令牌条目(用于 sha256 精确校验)。 */
  tokenItems?: Array<Record<string, unknown>>;
  verifyMethods?: Array<
    { method: string; available: boolean; reason?: string }
  >;
  oauthProviders?: Array<{ slug: string; name?: string }>;
  passwordEncryption?: boolean;
  /** /api/verify 的排队响应(依次消费);缺省一律成功。 */
  verifyResponses?: Array<
    | { kind: "success"; proof?: string }
    | { kind: "failure"; code: string; message?: string }
    | { kind: "http"; status: number; body: unknown }
  >;
  createdToken?: string;
  createTokenStatus?: number;
  createTokenBody?: unknown;
  /** rc.34–40:GET /api/user/token 要求 X-Security-Proof。 */
  legacyTokenProofRequired?: boolean;
  /** 以存储/粘贴的令牌做探测时,是否视为有效。 */
  probeTokenValid?: boolean;
  /** 模拟 HTTP 页面:不注入 crypto(无 SubtleCrypto)。 */
  noSubtleCrypto?: boolean;
  /** 依次为每次 /api/user/auth/refresh 返回的 access token;缺省复用 dashboardToken。 */
  refreshTokenSequence?: string[];
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<(event?: unknown) => void>>();
  readonly style: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  id = "";
  value = "";
  placeholder = "";
  autocomplete = "";
  disabled = false;
  textContent = "";
  title = "";
  type = "";
  removed = false;
  offsetWidth = 120;
  offsetHeight = 36;
  clientWidth = 0;
  clientHeight = 0;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setPointerCapture(): void {}

  releasePointerCapture(): void {}

  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } {
    const left = Number.parseFloat(this.style.left) || 0;
    const top = Number.parseFloat(this.style.top) || 0;
    return {
      left,
      top,
      right: left + this.offsetWidth,
      bottom: top + this.offsetHeight,
      width: this.offsetWidth,
      height: this.offsetHeight,
    };
  }

  remove(): void {
    this.removed = true;
  }
}

function findByPredicate(
  root: FakeElement,
  predicate: (element: FakeElement) => boolean,
): FakeElement | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findByPredicate(child, predicate);
    if (found) return found;
  }
  return null;
}

class FakePopup {
  closed = false;
  navigatedTo = "";
  readonly messages: Array<{ data: unknown; origin?: string }> = [];
  readonly storage = new Map<string, string>();
  readonly sessionStorage = {
    getItem: (key: string): string | null =>
      this.storage.get(String(key)) ?? null,
    setItem: (key: string, value: string): void => {
      this.storage.set(String(key), String(value));
    },
  };
  readonly location = {
    replace: (url: string): void => {
      this.navigatedTo = url;
    },
  };

  postMessage(data: unknown, origin?: string): void {
    this.messages.push({ data, origin });
  }

  close(): void {
    this.closed = true;
  }
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function spkiToPem(spki: ArrayBuffer): string {
  const base64 = bufferToBase64(spki);
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${
    lines.join("\n")
  }\n-----END PUBLIC KEY-----`;
}

async function createRsaKeyPair(): Promise<{
  publicKeyPem: string;
  privateKey: CryptoKey;
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return { publicKeyPem: spkiToPem(spki), privateKey: pair.privateKey };
}

async function decryptPasswordPayload(
  privateKey: CryptoKey,
  encrypted: string,
): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToBuffer(encrypted),
  );
  return new TextDecoder().decode(plain);
}

function sha256Hex(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(
    (digest) => {
      const bytes = new Uint8Array(digest);
      return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    },
  );
}

interface DialogState {
  overlay: FakeElement;
  input: FakeElement | null;
  select: FakeElement | null;
  submit: FakeElement | null;
  cancel: FakeElement | null;
  error: FakeElement | null;
}

interface Harness {
  browserCalls: BrowserCall[];
  ttsCalls: BrowserCall[];
  lockNames: string[];
  verifyCalls: BrowserCall[];
  accessTokenCreations: BrowserCall[];
  oauthStateCalls: BrowserCall[];
  oauthExchangeCalls: BrowserCall[];
  legacyTokenProofCalls: BrowserCall[];
  selfPasswordUpdates: BrowserCall[];
  popups: FakePopup[];
  privateKey: CryptoKey | null;
  getConfirmCount: () => number;
  getCapsuleLabel: () => string;
  getCapsuleButton: () => FakeElement;
  getStoredCapsulePos: () => { left: number; top: number } | null;
  click: () => Promise<void>;
  dialogState: () => DialogState | null;
  waitForDialog: () => Promise<DialogState>;
  submitDialog: (value?: string) => Promise<void>;
  cancelDialog: () => Promise<void>;
  runIntervals: () => void;
  dispatchOAuthCallback: (data: unknown) => void;
  hasText: (fragment: string) => boolean;
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
  const verifyCalls: BrowserCall[] = [];
  const accessTokenCreations: BrowserCall[] = [];
  const oauthStateCalls: BrowserCall[] = [];
  const oauthExchangeCalls: BrowserCall[] = [];
  const legacyTokenProofCalls: BrowserCall[] = [];
  const selfPasswordUpdates: BrowserCall[] = [];
  const popups: FakePopup[] = [];
  const windowListeners = new Map<string, Set<(event: unknown) => void>>();
  const intervals = new Map<number, () => void>();
  let intervalSeq = 0;
  let confirmCount = 0;
  const sessionValues = new Map<string, string>();
  const sessionStorage = {
    getItem(key: string): string | null {
      return sessionValues.get(String(key)) ?? null;
    },
    setItem(key: string, value: string): void {
      sessionValues.set(String(key), String(value));
    },
    removeItem(key: string): void {
      sessionValues.delete(String(key));
    },
    clear(): void {
      sessionValues.clear();
    },
  };
  if (options.capsulePos) {
    sessionStorage.setItem(
      "tts-capsule-pos",
      JSON.stringify(options.capsulePos),
    );
  }
  const rsaKeys = options.passwordEncryption ? await createRsaKeyPair() : null;
  const verifyResponses = [...(options.verifyResponses ?? [])];

  const document = {
    body: new FakeElement("body"),
    documentElement: new FakeElement("html"),
    readyState: "complete",
    createElement(tagName: string) {
      const element = new FakeElement(tagName);
      created.push(element);
      return element;
    },
    addEventListener(_type: string, _listener: () => void) {},
  };
  document.documentElement.clientWidth = 1000;
  document.documentElement.clientHeight = 800;
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
  const window = {
    open(): FakePopup {
      const popup = new FakePopup();
      popups.push(popup);
      return popup;
    },
    addEventListener(type: string, listener: (event: unknown) => void): void {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener(
      type: string,
      listener: (event: unknown) => void,
    ): void {
      windowListeners.get(type)?.delete(listener);
    },
  };
  const setIntervalStub = (callback: () => void): number => {
    intervalSeq += 1;
    intervals.set(intervalSeq, callback);
    return intervalSeq;
  };
  const clearIntervalStub = (id: number): void => {
    intervals.delete(id);
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
        data: {
          system_name: "new-api",
          version: "latest",
          start_time: 1,
          github_client_id: "github-client",
        },
      });
    }
    const method = init.method ?? "GET";
    if (path === "/api/user/self" && method === "PUT") {
      selfPasswordUpdates.push({ method, path, headers, body });
      return jsonResponse({
        success: true,
        data: {
          access_token: "rotated-dashboard",
          access_expires_at: 4_102_444_800,
          session: { sid: "session" },
          has_password: true,
        },
      });
    }
    if (path === "/api/user/self") {
      const authorization = headers.authorization ?? "";
      const isPatProbe = authorization.startsWith("Bearer ") &&
        authorization !== `Bearer ${dashboardToken}`;
      if (isPatProbe) {
        if (options.probeTokenValid === false) {
          return jsonResponse({ success: false, message: "Unauthorized" }, 401);
        }
        const probeUserId = Number(headers["new-api-user"] ?? modernUserId);
        return jsonResponse({
          success: true,
          data: { id: probeUserId, username: "probe" },
        });
      }
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
      const refreshedTokens = options.refreshTokenSequence ?? [];
      const refreshedToken = refreshedTokens.length
        ? refreshedTokens.shift()!
        : dashboardToken;
      return jsonResponse({
        success: true,
        data: {
          user: { id: modernUserId, username: "modern" },
          access_token: refreshedToken,
          access_expires_at: 4_102_444_800,
          session: { sid: "session" },
        },
      });
    }
    if (path === "/api/user/token") {
      if (method === "POST") {
        legacyTokenProofCalls.push({ method, path, headers, body });
        return jsonResponse({
          success: true,
          data: options.createdToken ?? generatedPat,
        });
      }
      if (options.legacyTokenProofRequired) {
        return jsonResponse({
          success: false,
          code: "SECURITY_PROOF_REQUIRED",
          message: "Additional verification required",
        }, 403);
      }
      return jsonResponse({ success: true, data: generatedPat });
    }
    if (path === "/api/user/access_tokens" && method === "GET") {
      if (!options.scopedSupport) {
        return jsonResponse(
          { success: false, message: "404 page not found" },
          404,
        );
      }
      return jsonResponse({
        success: true,
        data: { items: options.tokenItems ?? [], legacy: null },
      });
    }
    if (path === "/api/user/access_tokens" && method === "POST") {
      accessTokenCreations.push({ method, path, headers, body });
      if (options.createTokenStatus && options.createTokenStatus !== 200) {
        return jsonResponse(
          options.createTokenBody ?? { success: false, message: "failed" },
          options.createTokenStatus,
        );
      }
      return jsonResponse({
        success: true,
        data: { token: options.createdToken ?? "nap_created", item: { id: 1 } },
      });
    }
    if (path.startsWith("/api/verify/methods")) {
      return jsonResponse({
        success: true,
        data: {
          scope: "access_token.generate",
          methods: options.verifyMethods ?? [{
            method: "password",
            available: true,
          }],
          oauth_providers: options.oauthProviders ?? [],
          password_encryption_enabled: options.passwordEncryption === true,
        },
      });
    }
    if (path === "/api/verify" && method === "POST") {
      verifyCalls.push({ method, path, headers, body });
      const queued = verifyResponses.shift();
      if (queued) {
        if (queued.kind === "success") {
          return jsonResponse({
            success: true,
            data: {
              proof_token: queued.proof ?? "proof-1",
              scope: "access_token.generate",
              method: "password",
              expires_at: 9_999_999_999,
            },
          });
        }
        if (queued.kind === "failure") {
          return jsonResponse({
            success: false,
            code: queued.code,
            message: queued.message ?? "Verification failed. Please try again.",
          });
        }
        return jsonResponse(queued.body, queued.status);
      }
      return jsonResponse({
        success: true,
        data: {
          proof_token: `proof-${verifyCalls.length}`,
          scope: "access_token.generate",
          method: "password",
          expires_at: 9_999_999_999,
        },
      });
    }
    if (path === "/api/user/login/encryption-key" && method === "GET") {
      return jsonResponse({
        success: true,
        data: {
          enabled: true,
          kid: "kid-1",
          public_key: rsaKeys ? rsaKeys.publicKeyPem : "",
        },
      });
    }
    if (path === "/api/oauth/state" && method === "POST") {
      oauthStateCalls.push({ method, path, headers, body });
      return jsonResponse({
        success: true,
        data: { flow_token: "flow-1", expires_at: 9_999_999_999 },
      });
    }
    if (path.startsWith("/api/oauth/") && method === "GET") {
      oauthExchangeCalls.push({ method, path, headers, body: null });
      return jsonResponse({
        success: true,
        data: {
          proof_token: "oauth-proof",
          scope: "account.password.set",
          method: "oauth",
          expires_at: 9_999_999_999,
        },
      });
    }
    if (path === "/api/token/?p=1&page_size=10") {
      const total = options.tokenTotal ?? 1;
      return jsonResponse({ success: true, data: { total, items: [] } });
    }
    if (path === "/api/user/checkin" && method === "GET") {
      return jsonResponse({ success: true, data: { enabled: true } });
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
      query: Object.fromEntries(url.searchParams.entries()),
    };
    ttsCalls.push(call);

    let responseBody: unknown;
    if (call.method === "GET" && call.path === "/api/sites") {
      const pageIndex = Number(url.searchParams.get("pageIndex") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
      const targetPage = options.existingPage ?? 1;
      const totalCount = options.existing ? (targetPage - 1) * pageSize + 1 : 0;
      const items = options.existing && pageIndex === targetPage
        ? [{ id: 11, origin }]
        : options.existing && pageIndex < targetPage
        ? Array.from({ length: pageSize }, (_, index) => ({
          id: 1_000 + index,
          origin: `${origin}.candidate-${index}`,
        }))
        : [];
      responseBody = { items, pageSize, pageIndex, totalCount };
    } else if (call.method === "GET" && call.path === "/api/accounts") {
      const userId = options.localUser && (options.legacyStatus ?? 200) === 200
        ? legacyUserId
        : modernUserId;
      const pageIndex = Number(url.searchParams.get("pageIndex") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
      const targetPage = options.existingPage ?? 1;
      const totalCount = options.existing ? (targetPage - 1) * pageSize + 1 : 0;
      const items = options.existing && pageIndex === targetPage
        ? [{
          id: 22,
          site_id: 11,
          user_id: String(userId),
          access_token: options.storedAccountToken ?? null,
        }]
        : options.existing && pageIndex < targetPage
        ? Array.from({ length: pageSize }, (_, index) => ({
          id: 2_000 + index,
          site_id: 11,
          user_id: String(userId) + String(index + 1),
        }))
        : [];
      responseBody = { items, pageSize, pageIndex, totalCount };
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
    "sessionStorage",
    "location",
    "navigator",
    "fetch",
    "GM_xmlhttpRequest",
    "confirm",
    "setTimeout",
    "setInterval",
    "clearInterval",
    "window",
    "crypto",
    source,
  ) as (...args: unknown[]) => void;
  execute(
    document,
    localStorage,
    sessionStorage,
    { origin },
    navigator,
    fetch,
    gmXmlHttpRequest,
    confirm,
    fakeSetTimeout,
    setIntervalStub,
    clearIntervalStub,
    window,
    options.noSubtleCrypto ? undefined : globalThis.crypto,
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

  function dialogState(): DialogState | null {
    const overlays = created.filter((element) => element.id === "tts-dialog");
    const overlay = overlays[overlays.length - 1];
    if (!overlay || overlay.removed) return null;
    return {
      overlay,
      input: findByPredicate(
        overlay,
        (element) => element.id === "tts-dialog-input",
      ),
      select: findByPredicate(
        overlay,
        (element) => element.id === "tts-dialog-select",
      ),
      submit: findByPredicate(
        overlay,
        (element) => element.id === "tts-dialog-submit",
      ),
      cancel: findByPredicate(
        overlay,
        (element) => element.id === "tts-dialog-cancel",
      ),
      error: findByPredicate(
        overlay,
        (element) => element.id === "tts-dialog-error",
      ),
    };
  }

  const harness: Harness = {
    browserCalls,
    ttsCalls,
    lockNames,
    verifyCalls,
    accessTokenCreations,
    oauthStateCalls,
    oauthExchangeCalls,
    legacyTokenProofCalls,
    selfPasswordUpdates,
    popups,
    privateKey: rsaKeys ? rsaKeys.privateKey : null,
    getConfirmCount: () => confirmCount,
    // 小胶囊文案在 label span 上;toast 用的是 div,不会误取。
    getCapsuleLabel: () =>
      created.find((element) => element.tagName === "span")?.textContent ?? "",
    getCapsuleButton: () => button,
    getStoredCapsulePos: () => {
      const raw = sessionStorage.getItem("tts-capsule-pos");
      return raw ? JSON.parse(raw) : null;
    },
    async click() {
      let wasBusy = false;
      button.dispatch("click");
      await waitUntil(
        () => {
          if (button.disabled) {
            wasBusy = true;
            return false;
          }
          return wasBusy ||
            ttsCalls.some((call) =>
              call.method === "POST" && call.path === "/api/accounts"
            ) ||
            (confirmCount > 0 && options.confirmResult === false);
        },
        "userscript click flow did not finish",
      );
      await settle();
    },
    dialogState,
    async waitForDialog() {
      for (let attempt = 0; attempt < 200; attempt++) {
        const state = dialogState();
        if (state) return state;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error("userscript dialog did not open");
    },
    async submitDialog(value?: string) {
      const state = await harness.waitForDialog();
      if (value !== undefined && state.input) state.input.value = value;
      assert(state.submit, "dialog submit button missing");
      state.submit.dispatch("click");
      await settle();
    },
    async cancelDialog() {
      const state = await harness.waitForDialog();
      assert(state.cancel, "dialog cancel button missing");
      state.cancel.dispatch("click");
      await settle();
    },
    runIntervals() {
      for (const callback of [...intervals.values()]) callback();
    },
    dispatchOAuthCallback(data: unknown) {
      const popup = popups[popups.length - 1] ?? null;
      for (const listener of [...(windowListeners.get("message") ?? [])]) {
        listener({ origin, source: popup, data });
      }
    },
    hasText: (fragment: string) =>
      created.some((element) =>
        String(element.textContent ?? "").includes(fragment)
      ),
  };
  return harness;
}

Deno.test("userscript 优先使用有效的旧版 localStorage 登录态", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
  });
  assertEquals(
    harness.getCapsuleLabel(),
    "快捷录入",
    "idle capsule label mismatch",
  );
  await harness.click();
  assertEquals(
    harness.getCapsuleLabel(),
    "快捷录入",
    "capsule did not return to idle after quick entry",
  );

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

Deno.test("userscript 精确过滤并逐页查找已录入账号", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
    existing: true,
    existingPage: 2,
    confirmResult: false,
  });
  await harness.click();

  assert(
    harness.ttsCalls.some((call) =>
      call.path === "/api/sites" && call.query?.pageIndex === "2"
    ),
    "site lookup must continue to the second page",
  );
  assert(
    harness.ttsCalls.some((call) =>
      call.path === "/api/accounts" && call.query?.pageIndex === "2"
    ),
    "account lookup must continue to the second page",
  );
  assert(
    harness.ttsCalls.filter((call) => call.path === "/api/sites").every(
      (call) => call.query?.siteQ === "https://new-api.example",
    ),
    "site lookup must use the exact origin as its search term",
  );
  assert(
    harness.ttsCalls.filter((call) => call.path === "/api/accounts").every(
      (call) => call.query?.siteId === "11" && call.query?.accountQ === "7",
    ),
    "account lookup must filter by site and user id",
  );
  assertEquals(harness.getConfirmCount(), 1, "second-page match must ask once");
  assert(
    !harness.ttsCalls.some((call) => call.method === "POST"),
    "cancelled second-page match must not perform writes",
  );
});

Deno.test("小胶囊支持拖拽并把位置记录到 sessionStorage", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
  });
  const button = harness.getCapsuleButton();
  // 固定起始坐标,让拖拽断言与默认停靠位置解耦。
  button.style.left = "0px";
  button.style.top = "0px";
  button.dispatch("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 200,
    clientY: 150,
  });
  button.dispatch("pointermove", {
    pointerId: 1,
    clientX: 260,
    clientY: 190,
  });
  button.dispatch("pointerup", {
    pointerId: 1,
    clientX: 260,
    clientY: 190,
  });
  assertEquals(button.style.left, "60px", "dragged left mismatch");
  assertEquals(button.style.top, "40px", "dragged top mismatch");
  assertEquals(
    harness.getStoredCapsulePos(),
    { left: 60, top: 40 },
    "capsule position was not stored",
  );

  // 拖拽结束紧随的 click 必须被吞掉,不能触发录入。
  button.dispatch("click");
  await settle();
  assertEquals(
    harness.getCapsuleLabel(),
    "快捷录入",
    "drag click started quick entry",
  );
  assert(
    !harness.ttsCalls.some((call) => call.method === "POST"),
    "drag click performed a write",
  );
});

Deno.test("小胶囊从 sessionStorage 恢复拖拽位置", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
    capsulePos: { left: 120, top: 80 },
  });
  const button = harness.getCapsuleButton();
  assertEquals(button.style.left, "120px", "stored left not restored");
  assertEquals(button.style.top, "80px", "stored top not restored");
});

Deno.test("小胶囊初始停靠页面左下角", async () => {
  const harness = await createHarness({
    localUser: JSON.stringify({ id: 7, username: "legacy" }),
  });
  const button = harness.getCapsuleButton();
  assertEquals(button.style.left, "20px", "default left mismatch");
  assertEquals(button.style.bottom, "20px", "default bottom mismatch");
  assertEquals(button.style.right, "auto", "default right must be released");
  assertEquals(button.style.top, "auto", "default top must be released");
  assertEquals(
    harness.getStoredCapsulePos(),
    null,
    "default position must not be persisted",
  );
});

Deno.test("合并后的囤囤鼠脚本元数据与胶囊文案正确且可执行", () => {
  const source = buildUserScript({
    baseUrl: "https://tuntunshu.example",
    authKey: 'quote"key',
  });
  for (
    const directive of [
      "// @name         囤囤鼠脚本",
      "// @version      2.1.0",
      "// @match        *://*/*",
      "// @grant        GM_xmlhttpRequest",
      "// @connect      tuntunshu.example",
      "// @inject-into  page",
      "// @run-at       document-start",
      "// @noframes",
      "https://tuntunshu.example/tuntunshu.user.js?key=quote%22key",
    ]
  ) {
    assert(source.includes(directive), `missing metadata: ${directive}`);
  }
  // 胶囊文案:空闲态「快捷录入」、免登态「免登中(用户名)」,以及分步进度。
  assert(source.includes('"快捷录入"'), "快捷录入 capsule label missing");
  assert(source.includes('"免登中（"'), "免登中 capsule label missing");
  assert(source.includes("退出登录态…"), "免登 progress step missing");
  assert(source.includes("注入免登拦截…"), "hijack progress step missing");
  new Function(source);
});

Deno.test("userscript 新版:静默用户名失败后弹窗密码并创建 scoped 令牌", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyResponses: [
      { kind: "failure", code: "SECURITY_VERIFICATION_FAILED" },
      { kind: "success", proof: "proof-2" },
    ],
    createdToken: "nap_created_token",
  });
  const run = harness.click();
  const dialog = await harness.waitForDialog();
  assertEquals(dialog.input?.value, "", "密码弹窗不得预填密码");
  assertEquals(dialog.input?.type, "password", "密码输入应为 password 类型");
  await harness.submitDialog("real-password");
  await run;

  assertEquals(
    harness.verifyCalls.length,
    2,
    "应包含静默尝试与弹窗重试各一次验证",
  );
  assertEquals(
    bodyOf(harness.verifyCalls[0]).method,
    "password",
    "静默尝试应使用密码验证",
  );
  assertEquals(
    bodyOf(harness.verifyCalls[0]).password,
    "modern",
    "静默尝试应使用用户名",
  );
  assertEquals(
    JSON.stringify(bodyOf(harness.verifyCalls[0]).context),
    JSON.stringify({ scopes: PAT_SCOPES, expires_at: 0 }),
    "proof context 必须与创建请求保持一致",
  );
  assertEquals(
    bodyOf(harness.verifyCalls[1]).password,
    "real-password",
    "弹窗密码未提交",
  );
  assertEquals(harness.accessTokenCreations.length, 1, "应创建一次访问令牌");
  const creation = harness.accessTokenCreations[0];
  assertEquals(
    creation.headers["x-security-proof"],
    "proof-2",
    "创建请求缺少 proof",
  );
  assertEquals(
    JSON.stringify(creation.body),
    JSON.stringify({ name: "囤囤鼠", scopes: PAT_SCOPES, expires_at: 0 }),
    "创建访问令牌的参数不符",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_created_token",
    "TTS 应保存新创建的令牌",
  );
});

Deno.test("userscript 新版:用户名即密码时静默创建令牌(无弹窗)", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyResponses: [{ kind: "success", proof: "proof-silent" }],
    createdToken: "nap_silent",
  });
  await harness.click();

  assertEquals(harness.dialogState(), null, "静默成功不应弹出验证框");
  assertEquals(harness.verifyCalls.length, 1, "应只验证一次");
  assertEquals(
    bodyOf(harness.verifyCalls[0]).password,
    "modern",
    "静默尝试应使用用户名",
  );
  assertEquals(harness.accessTokenCreations.length, 1, "应创建一次令牌");
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_silent",
    "TTS 应保存静默创建的令牌",
  );
});

Deno.test("userscript 新版:2FA 账号输入动态码并支持重试", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyMethods: [{ method: "2fa", available: true }],
    verifyResponses: [
      { kind: "failure", code: "SECURITY_VERIFICATION_FAILED" },
      { kind: "success", proof: "proof-2fa" },
    ],
    createdToken: "nap_2fa",
  });
  const run = harness.click();
  const dialog = await harness.waitForDialog();
  assertEquals(harness.verifyCalls.length, 0, "2FA 不应做静默密码尝试");
  assertEquals(dialog.input?.value, "", "动态码输入不得预填");
  await harness.submitDialog("123456");
  await waitUntil(
    () => dialog.error?.textContent === "验证码不正确,请重试",
    "2FA 错误提示缺失",
  );
  await harness.submitDialog("654321");
  await run;

  assertEquals(
    bodyOf(harness.verifyCalls[0]).method,
    "2fa",
    "验证方式应为 2fa",
  );
  assertEquals(
    bodyOf(harness.verifyCalls[0]).code,
    "123456",
    "首次动态码未提交",
  );
  assertEquals(
    bodyOf(harness.verifyCalls[1]).code,
    "654321",
    "重试动态码未提交",
  );
  assertEquals(
    harness.accessTokenCreations[0]?.headers["x-security-proof"],
    "proof-2fa",
    "创建请求缺少 2FA proof",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_2fa",
    "TTS 应保存 2FA 流程令牌",
  );
});

Deno.test("userscript 无密码账号:OAuth 授权设置密码后创建令牌", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyMethods: [{ method: "oauth", available: true }],
    oauthProviders: [{ slug: "github", name: "GitHub" }],
    createdToken: "nap_oauth",
  });
  const run = harness.click();
  const dialog = await harness.waitForDialog();
  assertEquals(dialog.input?.value, "modern", "默认密码应为用户名");

  await harness.submitDialog();
  await waitUntil(
    () => (dialog.error?.textContent ?? "").includes("8–128"),
    "过短密码未提示",
  );

  await harness.submitDialog("modern-password");
  await waitUntil(() => harness.popups.length === 1, "OAuth 弹窗未打开");
  const popup = harness.popups[0];
  await waitUntil(
    () => popup.navigatedTo.length > 0,
    "OAuth 弹窗未跳转授权页",
  );
  assert(
    popup.navigatedTo.includes("github-client"),
    "授权 URL 缺少 client_id",
  );
  assert(popup.navigatedTo.includes("state=flow-1"), "授权 URL 缺少 state");
  assertEquals(
    popup.storage.get("oauth_popup_flow:github"),
    JSON.stringify({ state: "flow-1", intent: "verify" }),
    "弹窗会话标记不符",
  );

  harness.dispatchOAuthCallback({
    type: "oauth:popup:callback",
    intent: "verify",
    provider: "github",
    state: "flow-1",
    code: "code-1",
  });
  await run;

  assertEquals(harness.oauthStateCalls.length, 1, "应发起一次 OAuth 授权");
  assertEquals(
    bodyOf(harness.oauthStateCalls[0]).scope,
    "account.password.set",
    "授权 scope 应为设置密码",
  );
  assertEquals(
    bodyOf(harness.oauthStateCalls[0]).intent,
    "verify",
    "OAuth intent 应为 verify",
  );
  assert(
    (harness.oauthExchangeCalls[0]?.path ?? "").includes("code=code-1"),
    "回调交换缺少 code",
  );
  assertEquals(harness.selfPasswordUpdates.length, 1, "应设置一次密码");
  assertEquals(
    harness.selfPasswordUpdates[0].headers["x-security-proof"],
    "oauth-proof",
    "设置密码必须携带 OAuth proof",
  );
  assertEquals(
    JSON.stringify(harness.selfPasswordUpdates[0].body),
    JSON.stringify({ password: "modern-password" }),
    "设置密码请求体不符",
  );
  assertEquals(
    harness.verifyCalls[0]?.headers.authorization,
    "Bearer rotated-dashboard",
    "密码验证必须使用轮换后的会话 token",
  );
  assertEquals(
    bodyOf(harness.verifyCalls[0]).password,
    "modern-password",
    "应使用刚设置的密码验证",
  );
  assertEquals(
    harness.accessTokenCreations[0]?.headers.authorization,
    "Bearer rotated-dashboard",
    "创建令牌必须使用轮换后的会话 token",
  );
  assert(popup.closed, "OAuth 弹窗应关闭");
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_oauth",
    "TTS 应保存 OAuth 流程令牌",
  );
});

Deno.test("userscript 无密码账号:关闭 OAuth 弹窗后展示取消错误", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyMethods: [{ method: "oauth", available: true }],
    oauthProviders: [{ slug: "github", name: "GitHub" }],
  });
  const run = harness.click();
  await harness.waitForDialog();
  await harness.submitDialog("modern-password");
  await waitUntil(() => harness.popups.length === 1, "OAuth 弹窗未打开");
  const popup = harness.popups[0];
  await waitUntil(
    () => popup.navigatedTo.length > 0,
    "OAuth 弹窗未跳转授权页",
  );
  popup.closed = true;
  harness.runIntervals();
  await waitUntil(
    () => {
      const state = harness.dialogState();
      return !!state && (state.error?.textContent ?? "").includes("取消");
    },
    "关窗后未提示取消",
  );
  assertEquals(harness.selfPasswordUpdates.length, 0, "取消后不得设置密码");
  await harness.cancelDialog();
  await run;
});

Deno.test("userscript 手动兜底:2FA 锁定时粘贴令牌并按 token_ref 校验", async () => {
  const pasted = "nap_pasted";
  const ref = await sha256Hex(pasted);
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyMethods: [{
      method: "2fa",
      available: false,
      reason: "Two-factor authentication is temporarily locked.",
    }],
    tokenItems: [{ token_ref: ref, scopes: PAT_SCOPES, expires_at: 0 }],
  });
  const run = harness.click();
  const dialog = await harness.waitForDialog();
  assert(
    findByPredicate(
      dialog.overlay,
      (element) => element.textContent.includes("locked"),
    ),
    "锁定原因未展示",
  );
  await harness.submitDialog(pasted);
  await run;

  assertEquals(harness.verifyCalls.length, 0, "手动粘贴不应发起验证");
  assertEquals(harness.accessTokenCreations.length, 0, "手动粘贴不应创建令牌");
  assert(
    harness.browserCalls.some((call) =>
      call.path === "/api/user/self" &&
      call.headers.authorization === `Bearer ${pasted}`
    ),
    "粘贴的令牌未被探测",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    pasted,
    "TTS 应保存粘贴的令牌",
  );
});

Deno.test("userscript 手动兜底:令牌缺少权限时拒绝并保留弹窗", async () => {
  const pasted = "nap_narrow";
  const ref = await sha256Hex(pasted);
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyMethods: [{ method: "passkey", available: true }],
    tokenItems: [{ token_ref: ref, scopes: ["profile:read"], expires_at: 0 }],
  });
  const run = harness.click();
  await harness.waitForDialog();
  await harness.submitDialog(pasted);
  await waitUntil(
    () => {
      const state = harness.dialogState();
      return !!state && (state.error?.textContent ?? "").includes("缺少权限");
    },
    "缺少权限未提示",
  );
  await harness.cancelDialog();
  await waitUntil(() => harness.dialogState() === null, "取消后弹窗应关闭");
  await settle();
  assert(
    !harness.ttsCalls.some((call) =>
      call.method === "POST" && call.path === "/api/accounts"
    ),
    "取消后不应保存账号",
  );
  await run;
});

Deno.test("userscript 复用已存 scoped 令牌:跳过验证与创建", async () => {
  const stored = "nap_existing";
  const ref = await sha256Hex(stored);
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    existing: true,
    storedAccountToken: stored,
    tokenItems: [{ token_ref: ref, scopes: PAT_SCOPES, expires_at: 0 }],
  });
  await harness.click();

  assertEquals(harness.getConfirmCount(), 1, "已录入必须确认一次");
  assertEquals(harness.verifyCalls.length, 0, "复用不应发起验证");
  assertEquals(harness.accessTokenCreations.length, 0, "复用不应创建令牌");
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    stored,
    "复用路径应保存已存令牌",
  );
});

Deno.test("userscript 旧版上游:复用已存 legacy 令牌且不轮换", async () => {
  const harness = await createHarness({
    localUser: null,
    existing: true,
    storedAccountToken: "legacy-token-32chars",
  });
  await harness.click();

  assertEquals(harness.verifyCalls.length, 0, "旧版复用不应发起验证");
  assert(
    !harness.browserCalls.some((call) => call.path === "/api/user/token"),
    "复用有效令牌不应轮换旧 accessToken",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "legacy-token-32chars",
    "TTS 应继续保存可用的旧令牌",
  );
});

Deno.test("userscript rc.34–40:旧端点要求 proof 时验证并携带 X-Security-Proof", async () => {
  const harness = await createHarness({
    localUser: null,
    legacyTokenProofRequired: true,
  });
  await harness.click();

  assertEquals(harness.verifyCalls.length, 1, "应做一次密码验证");
  assertEquals(
    bodyOf(harness.verifyCalls[0]).password,
    "modern",
    "静默尝试应使用用户名",
  );
  assertEquals(
    "context" in bodyOf(harness.verifyCalls[0]),
    false,
    "rc.34–40 的 proof 不应携带 context",
  );
  assertEquals(
    harness.legacyTokenProofCalls.length,
    1,
    "应携带 proof 生成令牌",
  );
  assertEquals(
    harness.legacyTokenProofCalls[0].headers["x-security-proof"],
    "proof-1",
    "POST 生成令牌缺少 proof",
  );
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "pat-long-lived",
    "旧端点令牌未保存",
  );
});

Deno.test("userscript 新版:取消验证弹窗后中止保存", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyResponses: [
      { kind: "failure", code: "SECURITY_VERIFICATION_FAILED" },
    ],
  });
  const run = harness.click();
  await harness.waitForDialog();
  await harness.cancelDialog();
  await run;

  assert(
    !harness.ttsCalls.some((call) =>
      call.method === "POST" && call.path === "/api/accounts"
    ),
    "取消后不得保存账号",
  );
  assertEquals(harness.accessTokenCreations.length, 0, "取消后不得创建令牌");
});

Deno.test("userscript 新版:已存令牌失效时重新创建", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    existing: true,
    storedAccountToken: "nap_stale",
    probeTokenValid: false,
    createdToken: "nap_recreated",
  });
  await harness.click();

  assertEquals(harness.getConfirmCount(), 1, "已录入必须确认一次");
  assertEquals(harness.verifyCalls.length, 1, "失效令牌应走验证新建");
  assertEquals(harness.accessTokenCreations.length, 1, "应创建新令牌");
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_recreated",
    "TTS 应保存重建后的令牌",
  );
});

Deno.test("userscript 新版:带过期时间的令牌不被复用", async () => {
  const stored = "nap_expiring";
  const ref = await sha256Hex(stored);
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    existing: true,
    storedAccountToken: stored,
    tokenItems: [{
      token_ref: ref,
      scopes: PAT_SCOPES,
      expires_at: 1_791_688_000,
    }],
    createdToken: "nap_renewed",
  });
  await harness.click();

  assertEquals(harness.verifyCalls.length, 1, "带过期的令牌应被拒绝并新建");
  assertEquals(harness.accessTokenCreations.length, 1, "应创建新令牌");
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_renewed",
    "TTS 应保存续期后的令牌",
  );
});

Deno.test("userscript 新版:dashboard token 过期时自动刷新并重试", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyResponses: [
      {
        kind: "http",
        status: 401,
        body: {
          success: false,
          code: "AUTH_TOKEN_EXPIRED",
          message: "Unauthorized",
        },
      },
    ],
    refreshTokenSequence: [
      "dashboard-short-lived",
      "dashboard-short-lived",
      "dashboard-refreshed",
    ],
    createdToken: "nap_after_refresh",
  });
  await harness.click();

  assertEquals(harness.dialogState(), null, "刷新重试后应静默成功");
  assertEquals(harness.verifyCalls.length, 2, "401 后应自动重试一次");
  assertEquals(
    harness.verifyCalls[0]?.headers.authorization,
    "Bearer dashboard-short-lived",
    "首次请求应使用旧 token",
  );
  assertEquals(
    harness.verifyCalls[1]?.headers.authorization,
    "Bearer dashboard-refreshed",
    "重试必须使用刷新后的新 token",
  );
  assertEquals(harness.accessTokenCreations.length, 1, "重试成功后应创建令牌");
});

Deno.test("userscript 新版:指纹不在令牌列表时重建", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    existing: true,
    storedAccountToken: "nap_missing",
    tokenItems: [],
    createdToken: "nap_recreated_list",
  });
  await harness.click();

  assertEquals(harness.verifyCalls.length, 1, "列表查不到应走验证新建");
  assertEquals(harness.accessTokenCreations.length, 1, "应创建新令牌");
  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    "nap_recreated_list",
    "TTS 应保存重建后的令牌",
  );
});

Deno.test("userscript 新版:HTTP 页面无法加密时转手动粘贴", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    passwordEncryption: true,
    noSubtleCrypto: true,
  });
  const run = harness.click();
  const dialog = await harness.waitForDialog();

  assertEquals(harness.verifyCalls.length, 0, "不应进入必然失败的密码路径");
  assert(
    findByPredicate(
      dialog.overlay,
      (element) => element.textContent.includes("HTTP"),
    ),
    "缺少 HTTP 加密不可用提示",
  );
  await harness.cancelDialog();
  await run;
});

Deno.test("userscript 手动兜底:拒绝旧版令牌并接受 nap_ 令牌", async () => {
  const pasted = "nap_manual_ok";
  const ref = await sha256Hex(pasted);
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyMethods: [{ method: "passkey", available: true }],
    tokenItems: [{ token_ref: ref, scopes: PAT_SCOPES, expires_at: 0 }],
  });
  const run = harness.click();
  await harness.waitForDialog();
  await harness.submitDialog("legacy-token-1234567890");
  await waitUntil(
    () => {
      const state = harness.dialogState();
      return !!state && (state.error?.textContent ?? "").includes("nap_");
    },
    "旧版令牌未提示拒绝",
  );
  await harness.submitDialog(pasted);
  await run;

  const accountWrite = harness.ttsCalls.find((call) =>
    call.method === "POST" && call.path === "/api/accounts"
  );
  assertEquals(
    bodyOf(accountWrite).accessToken,
    pasted,
    "TTS 应保存手动粘贴的新版令牌",
  );
});

Deno.test("userscript 新版:令牌数量超限时给出明确提示", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    verifyResponses: [{ kind: "success" }],
    createTokenStatus: 400,
    createTokenBody: {
      success: false,
      code: "ACCESS_TOKEN_LIMIT",
      message: "You can create at most 20 access tokens",
    },
  });
  await harness.click();

  assert(harness.hasText("上限"), "超限提示缺失");
  assert(
    !harness.ttsCalls.some((call) =>
      call.method === "POST" && call.path === "/api/accounts"
    ),
    "超限后不得保存账号",
  );
});

Deno.test("userscript 新版:密码加密站点提交 RSA-OAEP 密文", async () => {
  const harness = await createHarness({
    localUser: null,
    scopedSupport: true,
    passwordEncryption: true,
    verifyResponses: [
      { kind: "failure", code: "SECURITY_VERIFICATION_FAILED" },
      { kind: "success" },
    ],
  });
  const run = harness.click();
  await harness.waitForDialog();
  await harness.submitDialog("real-password");
  await run;

  assertEquals(harness.verifyCalls.length, 2, "静默尝试与弹窗各一次");
  const first = bodyOf(harness.verifyCalls[0]);
  const second = bodyOf(harness.verifyCalls[1]);
  assertEquals(first.password, undefined, "加密站点不得提交明文密码");
  assertEquals(first.encryption_key_id, "kid-1", "加密 payload 应带 kid");
  assertEquals(second.password, undefined, "加密站点不得提交明文密码");
  assert(typeof first.password_encrypted === "string", "缺少密码密文");
  assert(typeof second.password_encrypted === "string", "缺少密码密文");
  const privateKey = harness.privateKey;
  assert(privateKey, "测试私钥缺失");
  assertEquals(
    await decryptPasswordPayload(privateKey, String(first.password_encrypted)),
    "modern",
    "静默尝试的密文应解密为用户名",
  );
  assertEquals(
    await decryptPasswordPayload(privateKey, String(second.password_encrypted)),
    "real-password",
    "弹窗输入的密文应解密为输入值",
  );
});
