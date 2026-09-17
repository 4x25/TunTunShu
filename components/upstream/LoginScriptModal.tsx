import { IconClose } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { UPSTREAM_LOGIN_SCRIPT_VERSION } from "./upstream_login.ts";

/**
 * 账号行「登录」在未检测到「囤囤鼠脚本」时弹出的分步引导。
 * 合并后只保留一份脚本,`installHref` 由调用方带上授权 key。
 */
export function LoginScriptModal(
  { open, onClose, installHref }: {
    open: boolean;
    onClose: () => void;
    installHref: string;
  },
) {
  return (
    <Modal open={open} onClose={onClose}>
      {open && (
        <>
          <div class="modal-head">
            <h3>未检测到囤囤鼠脚本</h3>
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
            <p class="page-sub" style="margin:0">
              由于当前页面未检测到「囤囤鼠脚本」，账号「登录」暂时无法免密跳转到上游站点，请按以下步骤操作：
            </p>
            <ol class="steps">
              <li>
                <b>
                  第一步
                </b>：点击下方「安装囤囤鼠脚本」，在浏览器油猴扩展中确认安装；
              </li>
              <li>
                <b>第二步</b>：回到囤囤鼠本页并刷新，让脚本注入页面；
              </li>
              <li>
                <b>
                  第三步
                </b>：再次点击账号行的「登录」，即可在新标签页直接进入上游账号。
              </li>
            </ol>
            <p class="page-sub" style="margin:0">
              若已安装仍看到此提示，请确认脚本已启用且版本为{" "}
              {UPSTREAM_LOGIN_SCRIPT_VERSION}，然后刷新本页。该脚本同时提供
              new-api 站点的「快捷录入」。
            </p>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" onClick={onClose}>
              关闭
            </button>
            <a
              class="btn btn-primary"
              href={installHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              安装囤囤鼠脚本
            </a>
          </div>
        </>
      )}
    </Modal>
  );
}
