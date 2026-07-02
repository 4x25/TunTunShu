import { IconClose } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { Field } from "./row_primitives.tsx";
import type { Account, ModalSpec, Site } from "./types.ts";

export function ResourceModal(
  {
    modal,
    form,
    errors,
    sites,
    accounts,
    saving,
    probing,
    siteName,
    onClose,
    onFieldChange,
    onProbeTitle,
    onProbeUsername,
    onProbeUsernameEdit,
    onSubmit,
  }: {
    modal: ModalSpec | null;
    form: Record<string, string>;
    errors: Record<string, string>;
    sites: Site[];
    accounts: Account[];
    saving: boolean;
    probing: boolean;
    siteName: (id: string) => string;
    onClose: () => void;
    onFieldChange: (key: string, value: string) => void;
    onProbeTitle: () => void;
    onProbeUsername: () => void;
    onProbeUsernameEdit: (accountId: string) => void;
    onSubmit: () => void;
  },
) {
  return (
    <Modal open={modal !== null} onClose={onClose}>
      {modal && (
        <>
          <div class="modal-head">
            <h3>
              {modal.mode === "create" ? "新建" : "编辑"}
              {modal.type === "site"
                ? "站点"
                : modal.type === "account"
                ? "账号"
                : " APIKey"}
            </h3>
            <button
              type="button"
              class="icon-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              <IconClose />
            </button>
          </div>
          <div class="modal-body">
            {modal.type === "site" && (
              <>
                <Field
                  label="Origin"
                  hint="例如 https://anyrouter.top"
                  k="origin"
                  form={form}
                  error={errors.origin}
                  update={onFieldChange}
                />
                <div class="field">
                  <label>
                    {modal.mode === "create"
                      ? "站点名称（可留空，自动取站点名称）"
                      : "站点名称"}
                  </label>
                  <div class="token-row">
                    <input
                      class={`input${errors.name ? " input-err" : ""}`}
                      placeholder="留空将自动获取站点名称"
                      value={form.name ?? ""}
                      onInput={(e) =>
                        onFieldChange(
                          "name",
                          (e.target as HTMLInputElement).value,
                        )}
                    />
                    <button
                      type="button"
                      class="btn btn-sm"
                      disabled={probing}
                      onClick={onProbeTitle}
                    >
                      {probing ? "获取中…" : "自动获取"}
                    </button>
                  </div>
                  {errors.name && <span class="field-err">{errors.name}</span>}
                  <span class="hint">
                    基于 Origin 的 /api/status（system_name）自动补全
                  </span>
                </div>
                <Field
                  label="备注（可选）"
                  hint=""
                  k="remark"
                  form={form}
                  update={onFieldChange}
                />
              </>
            )}
            {modal.type === "account" && (
              <>
                {modal.mode === "create" && (
                  <div class="field">
                    <label>所属站点</label>
                    <select
                      class={`select${errors.siteId ? " input-err" : ""}`}
                      value={form.siteId ?? ""}
                      onChange={(e) =>
                        onFieldChange(
                          "siteId",
                          (e.target as HTMLSelectElement).value,
                        )}
                    >
                      <option value="">选择站点…</option>
                      {sites.map((s) => (
                        <option value={s.id} key={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {errors.siteId && (
                      <span class="field-err">{errors.siteId}</span>
                    )}
                  </div>
                )}
                <Field
                  label="用户 ID"
                  hint="new-api userId"
                  k="userId"
                  form={form}
                  error={errors.userId}
                  update={onFieldChange}
                />
                <Field
                  label="AccessToken"
                  hint="粘贴登录令牌"
                  k="accessToken"
                  type="password"
                  form={form}
                  error={errors.accessToken}
                  update={onFieldChange}
                />
                <div class="field">
                  <label>账号名称（可留空，自动获取）</label>
                  <div class="token-row">
                    <input
                      class={`input${errors.name ? " input-err" : ""}`}
                      placeholder={modal.mode === "create"
                        ? "留空将自动获取用户名"
                        : "留空则保持原名称"}
                      value={form.name ?? ""}
                      onInput={(e) =>
                        onFieldChange(
                          "name",
                          (e.target as HTMLInputElement).value,
                        )}
                    />
                    <button
                      type="button"
                      class="btn btn-sm"
                      disabled={probing}
                      onClick={() =>
                        modal.mode === "create"
                          ? onProbeUsername()
                          : onProbeUsernameEdit(modal.id)}
                    >
                      {probing ? "获取中…" : "自动获取"}
                    </button>
                  </div>
                  {errors.name && <span class="field-err">{errors.name}</span>}
                  <span class="hint">
                    基于所属站点的 /api/user/self（username）自动补全
                  </span>
                </div>
              </>
            )}
            {modal.type === "apikey" && (
              <>
                <div class="field">
                  <label>所属账号</label>
                  <select
                    class={`select${errors.accountId ? " input-err" : ""}`}
                    value={form.accountId ?? ""}
                    onChange={(e) =>
                      onFieldChange(
                        "accountId",
                        (e.target as HTMLSelectElement).value,
                      )}
                  >
                    <option value="">选择账号…</option>
                    {accounts.map((a) => (
                      <option value={a.id} key={a.id}>
                        {siteName(a.site_id)} / {a.name}
                      </option>
                    ))}
                  </select>
                  {errors.accountId && (
                    <span class="field-err">{errors.accountId}</span>
                  )}
                </div>
                <Field
                  label="Key 名称"
                  hint="例如 default"
                  k="name"
                  form={form}
                  error={errors.name}
                  update={onFieldChange}
                />
                <Field
                  label="Key"
                  hint="sk-..."
                  k="key"
                  form={form}
                  error={errors.key}
                  update={onFieldChange}
                />
              </>
            )}
          </div>
          <div class="modal-foot">
            <button
              type="button"
              class="btn"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={saving}
              onClick={onSubmit}
            >
              {saving && <span class="btn-spinner"></span>}
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
