import { useRef, useState } from "preact/hooks";
import { IconEye, IconLock } from "../components/icons.tsx";
import { setToken } from "../components/admin_api.ts";

/** 登录卡片:校验访问密钥(= AUTH_KEY),成功后存入 localStorage 并进入仪表盘。 */
export default function LoginCard() {
  const [reveal, setReveal] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  function toggleReveal() {
    setReveal((v) => !v);
    queueMicrotask(() => pwRef.current?.focus());
  }

  async function submit() {
    if (!pw || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authKey: pw }),
      });
      const data = await res.json().catch(() => ({})) as { success?: boolean };
      if (data.success) {
        setToken(pw);
        globalThis.location.href = "/dashboard";
      } else {
        setError("访问密码不正确");
        setBusy(false);
      }
    } catch {
      setError("无法连接服务，请稍后重试");
      setBusy(false);
    }
  }

  return (
    <main class="login-card">
      <div class="login-brand">
        <span class="logo-mark">TT</span>
        <span class="name">TunTunShu</span>
        <span class="desc">多 AI 接口聚合中转站 · 单人控制台</span>
      </div>

      <form
        class="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div class="field">
          <label for="pw">访问密码</label>
          <div class="pw-wrap">
            <input
              ref={pwRef}
              class="input"
              id="pw"
              type={reveal ? "text" : "password"}
              placeholder="请输入访问密码"
              autocomplete="current-password"
              value={pw}
              onInput={(e) => {
                setPw((e.target as HTMLInputElement).value);
                if (error) setError("");
              }}
              autofocus
            />
            <button
              type="button"
              class="icon-btn reveal"
              aria-label={reveal ? "隐藏密码" : "显示密码"}
              onClick={toggleReveal}
            >
              <IconEye />
            </button>
          </div>
        </div>

        {error && (
          <div
            class="login-note"
            style="color:var(--bad);border-color:color-mix(in oklch,var(--bad) 30%,transparent);background:var(--bad-soft)"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          class="btn btn-primary btn-block"
          disabled={busy}
        >
          {busy ? "校验中…" : "登 录"}
        </button>

        <div class="login-note">
          <IconLock />
          本实例仅供个人单人使用，密码在系统设置中配置。
        </div>
      </form>

      <div class="login-foot">
        v1.4.2 · <a href="#">文档</a> · <a href="#">GitHub</a>
      </div>
    </main>
  );
}
