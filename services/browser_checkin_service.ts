import { relative, resolve, sep } from "node:path";
import type {
  BrowserContext,
  Page,
  Response as PlaywrightResponse,
} from "playwright-core";
import {
  assertSafeBrowserHostname,
  resolvePublicBrowserOrigin,
} from "../lib/browser_checkin_security.ts";
import {
  buildUpstreamAutomationInitScript,
  type UpstreamAutomationBootstrap,
} from "../lib/upstream_login_userscript.ts";
import { getTimezone } from "../lib/env.ts";
import {
  abandonActiveBrowserCheckinLeases,
  releaseActiveBrowserCheckinLeases,
} from "./browser_checkin_lease_service.ts";

const CLOAK_WRAPPER_VERSION = "0.5.10";
const PROFILE_PATHS = ["/profile", "/console/personal", "/console"];
const CHECKIN_PATH = "/api/user/checkin";
const CHALLENGE_HOST = "challenges.cloudflare.com";
const CLOAK_LICENSE_HOST = "cloakbrowser.dev";
const VALIDATOR_NAME = "__TTS_UPSTREAM_AUTOMATION_VALIDATE__";

export type BrowserCheckinCode =
  | "checked"
  | "already_checked"
  | "runtime_unavailable"
  | "invalid_input"
  | "unsafe_origin"
  | "navigation_failed"
  | "site_challenge_timeout"
  | "authentication_failed"
  | "user_mismatch"
  | "ui_unsupported"
  | "challenge_timeout"
  | "challenge_rejected"
  | "submit_failed"
  | "verification_failed"
  | "timeout"
  | "cancelled"
  | "cleanup_failed"
  | "internal_error";

export interface BrowserCheckinResult {
  ok: boolean;
  code: BrowserCheckinCode;
  message: string;
  durationMs: number;
}

export interface CloakBrowserRuntimeStatus {
  available: boolean;
  wrapperVersion: string | null;
  chromiumVersion: string | null;
  error?: string;
}

interface BrowserCheckinInput {
  origin: string;
  userId: string;
  accessToken: string;
  timeoutMs: number;
}

interface UpstreamUser {
  id: number | string;
  username: string;
  role: number;
}

interface ActiveRun {
  controller: AbortController;
  context: BrowserContext | null;
  closePromise: Promise<void> | null;
  workflow: Promise<BrowserCheckinResult> | null;
  workflowSettled: boolean;
  profileDir: string;
}

class BrowserFlowError extends Error {
  constructor(public code: BrowserCheckinCode, message: string) {
    super(message);
  }
}

const activeRuns = new Set<ActiveRun>();
let signalListenerInstalled = false;
let cloakModulePromise: Promise<typeof import("cloakbrowser")> | null = null;
let bundledMetadata: { version?: string; binaryPath: string } | null = null;

export function redactBrowserCheckinText(
  value: unknown,
  secrets: string[] = [],
): string {
  let text = value instanceof Error ? value.message : String(value ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.replaceAll(secret, "[redacted]");
    text = text.replaceAll(encodeURIComponent(secret), "[redacted]");
  }
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /([?&#](?:accessToken|turnstile|captcha)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .slice(0, 500);
}

export function isAllowedBrowserWebSocket(
  rawUrl: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  try {
    const target = new URL(rawUrl);
    const httpProtocol = target.protocol === "wss:"
      ? "https:"
      : target.protocol === "ws:"
      ? "http:"
      : "";
    if (!httpProtocol) return false;
    assertSafeBrowserHostname(target.hostname);
    return allowedOrigins.has(`${httpProtocol}//${target.host}`);
  } catch {
    return false;
  }
}

async function configureCloakEnvironment(): Promise<void> {
  if (
    !Deno.env.get("CLOAKBROWSER_BINARY_PATH") &&
    !Deno.env.get("CLOAKBROWSER_CACHE_DIR")
  ) {
    const bundledCache = resolve(Deno.cwd(), "_fresh", "cloakbrowser");
    try {
      if ((await Deno.stat(bundledCache)).isDirectory) {
        Deno.env.set("CLOAKBROWSER_CACHE_DIR", bundledCache);
        const metadata = JSON.parse(
          await Deno.readTextFile(
            resolve(bundledCache, "tuntunshu-install.json"),
          ),
        ) as { relativeBinaryPath?: unknown; version?: unknown };
        if (typeof metadata.relativeBinaryPath === "string") {
          const binaryPath = resolve(bundledCache, metadata.relativeBinaryPath);
          const relativePath = relative(bundledCache, binaryPath);
          if (
            relativePath && relativePath !== ".." &&
            !relativePath.startsWith(`..${sep}`) &&
            (await Deno.stat(binaryPath)).isFile
          ) {
            Deno.env.set("CLOAKBROWSER_BINARY_PATH", binaryPath);
            bundledMetadata = {
              binaryPath,
              version: typeof metadata.version === "string"
                ? metadata.version
                : undefined,
            };
          }
        }
      }
    } catch {
      // Local development may intentionally use CloakBrowser's default cache.
    }
  }
  if (!Deno.env.get("CLOAKBROWSER_AUTO_UPDATE")) {
    Deno.env.set("CLOAKBROWSER_AUTO_UPDATE", "false");
  }
}

async function inspectRuntimeBinary(
  cloak: typeof import("cloakbrowser"),
  timeoutMs = 5_000,
): Promise<{ available: boolean; path: string; version: string | null }> {
  const override = Deno.env.get("CLOAKBROWSER_BINARY_PATH");
  const info = cloak.binaryInfo();
  const path = override || info.binaryPath;
  try {
    if (!(await Deno.stat(path)).isFile) {
      return { available: false, path, version: null };
    }
    const output = await new Deno.Command(path, {
      args: ["--version", "--no-startup-window"],
      stdout: "piped",
      stderr: "null",
      clearEnv: true,
      env: childProcessEnvironment(),
      signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, timeoutMs))),
    }).output();
    const reported = new TextDecoder().decode(output.stdout).trim();
    const detectedVersion = reported.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
    return {
      available: output.success,
      path,
      version: bundledMetadata?.version ?? detectedVersion ?? info.version ??
        cloak.CHROMIUM_VERSION ?? null,
    };
  } catch {
    return { available: false, path, version: null };
  }
}

async function loadCloakBrowser() {
  await configureCloakEnvironment();
  cloakModulePromise ??= import("cloakbrowser");
  return await cloakModulePromise;
}

export async function getCloakBrowserRuntimeStatus(): Promise<
  CloakBrowserRuntimeStatus
> {
  try {
    const cloak = await loadCloakBrowser();
    const binary = await inspectRuntimeBinary(cloak);
    return {
      available: binary.available,
      wrapperVersion: CLOAK_WRAPPER_VERSION,
      chromiumVersion: binary.version,
      ...(binary.available
        ? {}
        : { error: "browser binary is not executable" }),
    };
  } catch (error) {
    return {
      available: false,
      wrapperVersion: CLOAK_WRAPPER_VERSION,
      chromiumVersion: null,
      error: redactBrowserCheckinText(error),
    };
  }
}

function installSignalListener(): void {
  if (signalListenerInstalled) return;
  signalListenerInstalled = true;
  try {
    Deno.addSignalListener("SIGINT", () => {
      const forcedExit = setTimeout(() => Deno.exit(0), 4_500);
      void (async () => {
        const closed = await closeActiveBrowserCheckins();
        if (closed) await releaseActiveBrowserCheckinLeases();
        else abandonActiveBrowserCheckinLeases();
      })().finally(() => {
        clearTimeout(forcedExit);
        Deno.exit(0);
      });
    });
  } catch {
    // Signals are unavailable on some local platforms, but production is Linux.
  }
}

export async function closeActiveBrowserCheckins(): Promise<boolean> {
  const closing = [...activeRuns].map(async (run) => {
    run.controller.abort();
    return (await finishRunCleanup(run, run.profileDir)).clean;
  });
  const results = await Promise.all(closing);
  return results.every(Boolean);
}

function remainingMs(
  deadline: number,
  maximum = Number.POSITIVE_INFINITY,
): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new BrowserFlowError("timeout", "浏览器验证超时");
  return Math.max(1, Math.min(remaining, maximum));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new BrowserFlowError("cancelled", "浏览器验证已取消");
  }
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    promise.then(() => "fulfilled" as const, () => "rejected" as const),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return completed;
}

async function removeTemporaryProfile(path: string): Promise<boolean> {
  const deadline = Date.now() + 4_000;
  while (true) {
    try {
      await Deno.remove(path, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound) && Date.now() >= deadline) {
        return false;
      }
    }

    // A Chromium process whose launch was interrupted can briefly recreate its
    // profile after Playwright rejects. Require a quiet absent window before
    // declaring cleanup complete.
    let absentSince = Date.now();
    while (Date.now() - absentSince < 500) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await Deno.stat(path);
        absentSince = 0;
        break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          absentSince = 0;
          break;
        }
      }
    }
    if (absentSince > 0) return true;
    if (Date.now() >= deadline) return false;
  }
}

async function profileBrowserPids(
  profileDir: string,
): Promise<number[] | null> {
  if (!profileDir) return null;
  try {
    const output = await new Deno.Command("/bin/ps", {
      args: ["-eo", "pid=,args="],
      stdout: "piped",
      stderr: "null",
      clearEnv: true,
      signal: AbortSignal.timeout(2_000),
    }).output();
    if (!output.success) return null;
    const marker = `--user-data-dir=${profileDir}`;
    return new TextDecoder().decode(output.stdout).split("\n").flatMap(
      (line) => {
        if (!line.includes(marker)) return [];
        const pid = Number.parseInt(line.trim().split(/\s+/, 1)[0], 10);
        return Number.isSafeInteger(pid) && pid > 1 ? [pid] : [];
      },
    );
  } catch {
    return null;
  }
}

async function terminateProfileBrowser(profileDir: string): Promise<boolean> {
  let pids = await profileBrowserPids(profileDir);
  if (pids == null) return false;
  for (const pid of pids) {
    try {
      Deno.kill(pid, "SIGTERM");
    } catch { /* process already exited */ }
  }
  if (pids.length) await new Promise((resolve) => setTimeout(resolve, 500));
  pids = await profileBrowserPids(profileDir);
  if (pids == null) return false;
  for (const pid of pids) {
    try {
      Deno.kill(pid, "SIGKILL");
    } catch { /* process already exited */ }
  }
  if (pids.length) await new Promise((resolve) => setTimeout(resolve, 200));
  const remaining = await profileBrowserPids(profileDir);
  return remaining !== null && remaining.length === 0;
}

async function finishRunCleanup(
  run: ActiveRun,
  profileDir: string,
): Promise<{ clean: boolean; forced: boolean }> {
  let forced = false;
  const closeCurrentContext = async () => {
    if (!run.context) return true;
    run.closePromise ??= run.context.close();
    const closeStatus = await settlesWithin(run.closePromise, 4_000);
    if (closeStatus === "fulfilled") {
      run.context = null;
      return true;
    }
    forced = true;
    if (!await terminateProfileBrowser(profileDir)) {
      if (closeStatus === "rejected") run.closePromise = null;
      return false;
    }
    run.context = null;
    run.closePromise = null;
    return true;
  };

  if (run.workflow && !run.workflowSettled && !run.context) {
    const workflowStatus = await settlesWithin(run.workflow, 2_000);
    if (workflowStatus === "timeout") {
      forced = true;
      await terminateProfileBrowser(profileDir);
      return { clean: false, forced };
    }
    run.workflowSettled = true;
  }
  if (!await closeCurrentContext()) return { clean: false, forced };

  if (run.workflow && !run.workflowSettled) {
    const workflowStatus = await settlesWithin(run.workflow, 2_000);
    if (workflowStatus === "timeout") {
      forced = true;
      await terminateProfileBrowser(profileDir);
      return { clean: false, forced };
    }
    run.workflowSettled = true;
    // A late launch can publish its context immediately before settling.
    if (!await closeCurrentContext()) return { clean: false, forced };
  }
  if (profileDir && !await removeTemporaryProfile(profileDir)) {
    return { clean: false, forced: true };
  }
  run.context = null;
  activeRuns.delete(run);
  return { clean: true, forced };
}

async function retryLateCleanup(run: ActiveRun, profileDir: string) {
  const deadline = Date.now() + 145_000;
  while (Date.now() < deadline) {
    if ((await finishRunCleanup(run, profileDir)).clean) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  // Keep the run registered for SIGINT if even process-specific termination
  // could not confirm cleanup. The database lease remains quarantined by TTL.
}

function childProcessEnvironment(): Record<string, string> {
  const source = Deno.env.toObject();
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "XDG_RUNTIME_DIR",
    "XDG_CONFIG_HOME",
    "FONTCONFIG_PATH",
    "CLOAKBROWSER_LICENSE_KEY",
  ];
  const result: Record<string, string> = {};
  for (const key of allowed) {
    if (source[key]) result[key] = source[key];
  }
  return result;
}

function buildEgressLockdownInitScript(): string {
  return `(function () {
  if (location.hostname === ${JSON.stringify(CHALLENGE_HOST)}) return;
  ["WebSocket", "Worker", "SharedWorker", "WebTransport", "RTCPeerConnection",
    "webkitRTCPeerConnection"].forEach(function (name) {
    try {
      Object.defineProperty(globalThis, name, {
        configurable: true, enumerable: false, writable: false, value: undefined
      });
    } catch (_) {}
  });
})();`;
}

function buildValidationInitScript(origin: string): string {
  return `(function () {
  if (globalThis.top !== globalThis || location.origin !== ${
    JSON.stringify(origin)
  }) return;
  var nativeFetch = globalThis.fetch.bind(globalThis);
  var parse = function (text) { try { return JSON.parse(text); } catch (_) { return null; } };
  Object.defineProperty(globalThis, ${JSON.stringify(VALIDATOR_NAME)}, {
    configurable: true,
    enumerable: false,
    value: async function (credentials) {
      var modern = await nativeFetch("/api/user/auth/logout", {
        method: "POST", credentials: "include", headers: { "Cache-Control": "no-store" }
      });
      var modernBody = parse(await modern.text());
      if (modern.status === 404 || modern.status === 405) {
        var legacy = await nativeFetch("/api/user/logout", {
          method: "GET", credentials: "include", headers: { "Cache-Control": "no-store" }
        });
        var legacyBody = parse(await legacy.text());
        if (!(legacy.status === 204 || (legacy.ok && legacyBody && legacyBody.success === true))) {
          return { ok: false, stage: "logout" };
        }
      } else if (!(modern.status === 204 || (modern.ok && modernBody && modernBody.success === true))) {
        return { ok: false, stage: "logout" };
      }
      localStorage.removeItem("user");
      localStorage.removeItem("uid");
      sessionStorage.removeItem("tts-upstream-login");
      var response = await nativeFetch("/api/user/self", {
        method: "GET",
        credentials: "include",
        headers: {
          "Authorization": "Bearer " + credentials.accessToken,
          "New-Api-User": credentials.userId,
          "Cache-Control": "no-store"
        }
      });
      var body = parse(await response.text());
      return { ok: response.ok && body && body.success === true, user: body && body.data };
    }
  });
  globalThis.stop();
})();`;
}

function isSiteInterstitial(value: { title: string; body: string }): boolean {
  return /just a moment|checking (?:your )?browser|verify you are human|执行安全验证|验证您是真人|cf-chl-/i
    .test(`${value.title}\n${value.body}`);
}

async function challengeState(page: Page) {
  return await page.evaluate(() => ({
    title: document.title || "",
    body: (document.body?.innerText || "").slice(0, 2000),
    readyState: document.readyState,
  }));
}

async function clickChallengeFrame(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (!frame.url().includes(CHALLENGE_HOST)) continue;
    for (
      const selector of [
        "label.ctp-checkbox-label",
        'input[type="checkbox"]',
        '[role="checkbox"]',
        "#challenge-stage",
      ]
    ) {
      const locator = frame.locator(selector).first();
      if (!await locator.count()) continue;
      try {
        await locator.click({ timeout: 1200 });
        return true;
      } catch {
        // Managed widgets often expose only the iframe surface.
      }
    }
    const element = await frame.frameElement().catch(() => null);
    const box = element && await element.boundingBox().catch(() => null);
    if (box && box.width > 40 && box.height > 40) {
      await page.mouse.move(
        box.x + Math.min(30, box.width / 2),
        box.y + box.height / 2,
      );
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
      return true;
    }
  }
  return false;
}

async function waitForSiteReady(
  page: Page,
  deadline: number,
  signal: AbortSignal,
): Promise<void> {
  const stageDeadline = Math.min(deadline, Date.now() + 30_000);
  let challengeSeen = false;
  while (Date.now() < stageDeadline) {
    throwIfAborted(signal);
    const state = await challengeState(page);
    const challenged = isSiteInterstitial(state);
    challengeSeen ||= challenged;
    if (!challenged && state.readyState !== "loading") return;
    await clickChallengeFrame(page);
    await page.waitForTimeout(500);
  }
  if (challengeSeen) {
    throw new BrowserFlowError(
      "site_challenge_timeout",
      "站点入口 Cloudflare 验证未在时限内完成",
    );
  }
  throw new BrowserFlowError("navigation_failed", "站点页面未完成加载");
}

async function safeGoto(
  page: Page,
  url: string,
  origin: string,
  deadline: number,
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: remainingMs(deadline, 30_000),
    });
  } catch (error) {
    if (Date.now() >= deadline) {
      throw new BrowserFlowError("timeout", "浏览器验证超时");
    }
    throw new BrowserFlowError(
      "navigation_failed",
      `页面导航失败: ${redactBrowserCheckinText(error)}`,
    );
  }
  const current = new URL(page.url());
  if (current.origin !== origin) {
    throw new BrowserFlowError("unsafe_origin", "站点页面发生了跨域跳转");
  }
}

async function clearLoginAndValidateUser(
  page: Page,
  input: BrowserCheckinInput,
  deadline: number,
  signal: AbortSignal,
): Promise<UpstreamUser> {
  throwIfAborted(signal);
  const result = await page.evaluate(async ({ name, accessToken, userId }) => {
    const validator = Reflect.get(globalThis, name);
    Reflect.deleteProperty(globalThis, name);
    if (typeof validator !== "function") return { ok: false, stage: "missing" };
    return await validator({ accessToken, userId });
  }, {
    name: VALIDATOR_NAME,
    accessToken: input.accessToken,
    userId: input.userId,
  });
  if (!result?.ok || !result.user) {
    throw new BrowserFlowError("authentication_failed", "AccessToken 验证失败");
  }
  if (Date.now() >= deadline) {
    throw new BrowserFlowError("timeout", "浏览器验证超时");
  }
  const user = result.user as Partial<UpstreamUser>;
  if (
    String(user.id) !== input.userId || typeof user.username !== "string" ||
    typeof user.role !== "number"
  ) {
    throw new BrowserFlowError("user_mismatch", "AccessToken 与用户 ID 不匹配");
  }
  return { id: user.id!, username: user.username, role: user.role };
}

async function readCheckinStatus(page: Page): Promise<{
  ok: boolean;
  checkedToday: boolean;
}> {
  return await page.evaluate(async () => {
    const response = await fetch("/api/user/checkin", {
      headers: { "Cache-Control": "no-store" },
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && body?.success === true,
      checkedToday: body?.data?.stats?.checked_in_today === true,
    };
  });
}

async function findCheckinPage(
  page: Page,
  origin: string,
  deadline: number,
  signal: AbortSignal,
): Promise<{ alreadyChecked: boolean }> {
  for (const path of PROFILE_PATHS) {
    throwIfAborted(signal);
    await safeGoto(page, origin + path, origin, deadline);
    const status = await readCheckinStatus(page).catch(() => ({
      ok: false,
      checkedToday: false,
    }));
    if (status.ok && status.checkedToday) return { alreadyChecked: true };

    const locator = page.locator(
      "xpath=//button[normalize-space(.)='立即签到' or " +
        "normalize-space(.)='Check in now' or normalize-space(.)='签到']",
    ).first();
    const waitUntil = Math.min(deadline, Date.now() + 12_000);
    while (Date.now() < waitUntil) {
      if (
        await locator.count() && await locator.isVisible().catch(() => false)
      ) {
        return { alreadyChecked: false };
      }
      await page.waitForTimeout(300);
    }
  }
  throw new BrowserFlowError("ui_unsupported", "未找到兼容的 new-api 签到页面");
}

function isCheckinPost(
  response: PlaywrightResponse,
  withToken?: boolean,
): boolean {
  try {
    const url = new URL(response.url());
    if (
      url.pathname !== CHECKIN_PATH ||
      response.request().method() !== "POST"
    ) return false;
    return withToken === undefined ||
      url.searchParams.has("turnstile") === withToken;
  } catch {
    return false;
  }
}

async function responseBody(response: PlaywrightResponse): Promise<{
  success?: boolean;
  message?: string;
}> {
  return await response.json().catch(() => ({})) as {
    success?: boolean;
    message?: string;
  };
}

async function waitForVerifiedResponse(
  page: Page,
  promise: Promise<PlaywrightResponse | null>,
  deadline: number,
  signal: AbortSignal,
): Promise<PlaywrightResponse> {
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const raced = await Promise.race([
      promise.then((response) => ({ response })),
      page.waitForTimeout(500).then(() => ({ response: undefined })),
    ]);
    if (raced.response) return raced.response;
    await clickChallengeFrame(page);
  }
  throw new BrowserFlowError(
    "challenge_timeout",
    "Turnstile 验证未在时限内完成",
  );
}

async function confirmChecked(
  page: Page,
  deadline: number,
  signal: AbortSignal,
): Promise<boolean> {
  const confirmDeadline = Math.min(deadline, Date.now() + 15_000);
  while (Date.now() < confirmDeadline) {
    throwIfAborted(signal);
    const status = await readCheckinStatus(page).catch(() => ({
      ok: false,
      checkedToday: false,
    }));
    if (status.ok && status.checkedToday) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function submitCheckin(
  page: Page,
  deadline: number,
  signal: AbortSignal,
): Promise<BrowserCheckinCode> {
  const firstResponsePromise = page.waitForResponse(
    (response) => isCheckinPost(response),
    { timeout: remainingMs(deadline) },
  ).catch(() => null);
  const verifiedResponsePromise = page.waitForResponse(
    (response) => isCheckinPost(response, true),
    { timeout: remainingMs(deadline) },
  ).catch(() => null);
  const button = page.locator(
    "xpath=//button[normalize-space(.)='立即签到' or " +
      "normalize-space(.)='Check in now' or normalize-space(.)='签到']",
  ).first();
  await button.click({ timeout: remainingMs(deadline, 10_000) });

  const firstResponse = await firstResponsePromise;
  if (!firstResponse) {
    throw new BrowserFlowError("submit_failed", "签到按钮未发出上游请求");
  }
  let verifiedResponse: PlaywrightResponse;
  if (isCheckinPost(firstResponse, true)) {
    verifiedResponse = firstResponse;
  } else {
    const firstBody = await responseBody(firstResponse);
    if (firstBody.success === true) {
      if (await confirmChecked(page, deadline, signal)) return "checked";
      throw new BrowserFlowError("verification_failed", "签到结果未能确认");
    }
    if (!/turnstile|captcha|验证码|人机验证/i.test(firstBody.message ?? "")) {
      throw new BrowserFlowError(
        "submit_failed",
        firstBody.message || "上游拒绝了签到请求",
      );
    }
    verifiedResponse = await waitForVerifiedResponse(
      page,
      verifiedResponsePromise,
      deadline,
      signal,
    );
  }

  const verifiedBody = await responseBody(verifiedResponse);
  const accepted = verifiedBody.success === true ||
    /已签到|已经签到|已签/.test(verifiedBody.message ?? "");
  if (!accepted) {
    throw new BrowserFlowError(
      "challenge_rejected",
      verifiedBody.message || "Turnstile 验证未被上游接受",
    );
  }
  if (!await confirmChecked(page, deadline, signal)) {
    throw new BrowserFlowError("verification_failed", "签到状态未确认成功");
  }
  return /已签到|已经签到|已签/.test(verifiedBody.message ?? "")
    ? "already_checked"
    : "checked";
}

async function runBrowserWorkflow(
  input: BrowserCheckinInput,
  run: ActiveRun,
  deadline: number,
  profileDir: string,
): Promise<BrowserCheckinResult> {
  const resolvedOrigin = await resolvePublicBrowserOrigin(input.origin).catch(
    (error) => {
      throw new BrowserFlowError(
        "unsafe_origin",
        redactBrowserCheckinText(error, [input.accessToken]),
      );
    },
  );
  const origin = resolvedOrigin.origin;
  throwIfAborted(run.controller.signal);
  const cloak = await loadCloakBrowser().catch(() => {
    throw new BrowserFlowError(
      "runtime_unavailable",
      "CloakBrowser 运行时不可用",
    );
  });
  throwIfAborted(run.controller.signal);
  const binary = await inspectRuntimeBinary(cloak, remainingMs(deadline));
  if (!binary.available) {
    throw new BrowserFlowError(
      "runtime_unavailable",
      "CloakBrowser 二进制未安装或无法执行",
    );
  }
  // Freeze this invocation to the preflighted artifact. A Production-only
  // license/version must not trigger a cold download outside the total budget.
  if (!Deno.env.get("CLOAKBROWSER_BINARY_PATH")) {
    Deno.env.set("CLOAKBROWSER_BINARY_PATH", binary.path);
  }
  throwIfAborted(run.controller.signal);

  const licenseKey = Deno.env.get("CLOAKBROWSER_LICENSE_KEY") || undefined;
  const pinnedAddress =
    resolvedOrigin.addresses.find((address) => !address.includes(":")) ??
      resolvedOrigin.addresses[0];
  const resolverTarget = pinnedAddress.includes(":")
    ? `[${pinnedAddress}]`
    : pinnedAddress;
  run.context = await cloak.launchPersistentContext({
    userDataDir: profileDir,
    headless: true,
    humanize: true,
    humanPreset: "careful",
    locale: "zh-CN",
    timezone: getTimezone(),
    viewport: { width: 1440, height: 1000 },
    args: [
      `--host-resolver-rules=MAP ${resolvedOrigin.hostname} ${resolverTarget},EXCLUDE ${CHALLENGE_HOST},EXCLUDE ${CLOAK_LICENSE_HOST},MAP * ~NOTFOUND`,
    ],
    licenseKey,
    contextOptions: {
      acceptDownloads: false,
      serviceWorkers: "block",
    },
    launchOptions: {
      timeout: remainingMs(deadline, 30_000),
      env: childProcessEnvironment(),
    },
  }).catch((error) => {
    throw new BrowserFlowError(
      "runtime_unavailable",
      `CloakBrowser 启动失败: ${
        redactBrowserCheckinText(error, [input.accessToken])
      }`,
    );
  });
  throwIfAborted(run.controller.signal);
  await run.context.addInitScript({ content: buildEgressLockdownInitScript() });

  const allowedOrigins = new Set([origin, `https://${CHALLENGE_HOST}`]);
  await run.context.route("**/*", async (route) => {
    try {
      const target = new URL(route.request().url());
      if (target.protocol === "data:" || target.protocol === "blob:") {
        await route.continue();
        return;
      }
      if (!allowedOrigins.has(target.origin)) {
        await route.abort("blockedbyclient");
        return;
      }
      assertSafeBrowserHostname(target.hostname);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient").catch(() => undefined);
    }
  });
  await run.context.routeWebSocket(/.*/, async (webSocket) => {
    try {
      if (!isAllowedBrowserWebSocket(webSocket.url(), allowedOrigins)) {
        await webSocket.close({
          code: 1008,
          reason: "blocked by egress policy",
        });
        return;
      }
      webSocket.connectToServer();
    } catch {
      await webSocket.close({ code: 1008, reason: "blocked by egress policy" })
        .catch(() => undefined);
    }
  });

  let page = run.context.pages()[0] ?? await run.context.newPage();
  await safeGoto(page, origin + "/", origin, deadline);
  await waitForSiteReady(page, deadline, run.controller.signal);
  await page.close();
  page = await run.context.newPage();
  await page.addInitScript({ content: buildValidationInitScript(origin) });
  try {
    await page.goto(origin + "/", {
      waitUntil: "commit",
      timeout: remainingMs(deadline, 20_000),
    });
  } catch {
    // The document-start validator intentionally calls window.stop(). Presence
    // of the validator below is the authoritative navigation result.
  }
  if (new URL(page.url()).origin !== origin) {
    throw new BrowserFlowError("unsafe_origin", "PAT 自检页面发生了跨域跳转");
  }
  await page.waitForFunction(
    (name) => typeof Reflect.get(globalThis, name) === "function",
    VALIDATOR_NAME,
    { timeout: remainingMs(deadline, 5_000) },
  ).catch(() => {
    throw new BrowserFlowError("navigation_failed", "PAT 自检页面启动失败");
  });
  const user = await clearLoginAndValidateUser(
    page,
    { ...input, origin },
    deadline,
    run.controller.signal,
  );

  const bootstrap: UpstreamAutomationBootstrap = {
    origin,
    accessToken: input.accessToken,
    userId: input.userId,
    user,
    tabNonce: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  await run.context.addInitScript({
    content: buildUpstreamAutomationInitScript(bootstrap),
  });
  await page.close();
  page = await run.context.newPage();
  const profile = await findCheckinPage(
    page,
    origin,
    deadline,
    run.controller.signal,
  );
  if (profile.alreadyChecked) {
    return {
      ok: true,
      code: "already_checked",
      message: "今日已签到",
      durationMs: 0,
    };
  }
  const code = await submitCheckin(page, deadline, run.controller.signal);
  return {
    ok: true,
    code,
    message: code === "already_checked" ? "今日已签到" : "浏览器自动签到成功",
    durationMs: 0,
  };
}

export async function runBrowserCheckin(
  input: BrowserCheckinInput,
): Promise<BrowserCheckinResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.min(
    120_000,
    Math.max(1_000, Math.trunc(input.timeoutMs)),
  );
  const secrets = [
    input.accessToken,
    Deno.env.get("CLOAKBROWSER_LICENSE_KEY") ?? "",
  ];
  if (!input.accessToken || !/^[1-9][0-9]*$/.test(input.userId)) {
    return {
      ok: false,
      code: "invalid_input",
      message: "浏览器签到参数无效",
      durationMs: Date.now() - startedAt,
    };
  }

  installSignalListener();
  const run: ActiveRun = {
    controller: new AbortController(),
    context: null,
    closePromise: null,
    workflow: null,
    workflowSettled: false,
    profileDir: "",
  };
  activeRuns.add(run);
  let profileDir = "";
  let result: BrowserCheckinResult;
  let cleanupFailed = false;
  let lateCleanup = false;
  let timedOut = false;
  let workflow: Promise<BrowserCheckinResult> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    profileDir = await Deno.makeTempDir({ prefix: "tts-cloak-checkin-" });
    run.profileDir = profileDir;
    workflow = runBrowserWorkflow(
      input,
      run,
      startedAt + timeoutMs,
      profileDir,
    );
    run.workflow = workflow;
    void workflow.finally(() => {
      run.workflowSettled = true;
    }).catch(() => undefined);
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        run.controller.abort();
        if (run.context) {
          run.closePromise ??= run.context.close();
          void run.closePromise.catch(() => undefined);
        }
        reject(new BrowserFlowError("timeout", "浏览器验证超时"));
      }, Math.max(1, startedAt + timeoutMs - Date.now()));
    });
    result = await Promise.race([workflow, deadline]);
  } catch (error) {
    const flowError = timedOut
      ? new BrowserFlowError("timeout", "浏览器验证超时")
      : error instanceof BrowserFlowError
      ? error
      : new BrowserFlowError(
        run.controller.signal.aborted ? "timeout" : "internal_error",
        redactBrowserCheckinText(error, secrets),
      );
    result = {
      ok: false,
      code: flowError.code,
      message: redactBrowserCheckinText(flowError.message, secrets) ||
        "浏览器自动签到失败",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut && workflow) {
      if (await settlesWithin(workflow, 3_000) === "timeout") {
        lateCleanup = true;
        cleanupFailed = true;
        void retryLateCleanup(run, profileDir).catch(() => undefined);
      }
    }
    if (!lateCleanup) {
      const cleanup = await finishRunCleanup(run, profileDir);
      if (!cleanup.clean) {
        lateCleanup = true;
        void retryLateCleanup(run, profileDir).catch(() => undefined);
      }
      cleanupFailed ||= !cleanup.clean || cleanup.forced;
    }
  }
  if (cleanupFailed) {
    return {
      ok: false,
      code: "cleanup_failed",
      message: "浏览器资源清理失败",
      durationMs: Date.now() - startedAt,
    };
  }
  return { ...result, durationMs: Date.now() - startedAt };
}
