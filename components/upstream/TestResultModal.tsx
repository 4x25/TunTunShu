import { EndpointIcon } from "../brand_icons.tsx";
import { IconClose } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { ENDPOINT_LABELS, TEST_KINDS } from "./constants.ts";
import type { TestResult, TestView } from "./types.ts";

export function TestResultModal(
  { testView, testOut, onClose, onRunAgain }: {
    testView: TestView | null;
    testOut: TestResult | "loading" | null;
    onClose: () => void;
    onRunAgain: () => void;
  },
) {
  return (
    <Modal open={testView !== null} onClose={onClose} wide>
      {testView && (
        <>
          <div class="modal-head">
            <h3>
              {TEST_KINDS.find((t) => t.kind === testView.kind)?.label} ·{" "}
              {testView.name}
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
            {testOut === "loading" || testOut === null
              ? <div class="muted">测试中…（正在直连上游发起真实请求）</div>
              : (
                <div class="test-result">
                  <div class="tr-row">
                    <span class="tr-k">端点</span>
                    <span class="tr-v tr-endpoint">
                      <EndpointIcon
                        type={testOut.endpointType}
                        class="brand-ico"
                      />
                      {ENDPOINT_LABELS[testOut.endpointType] ??
                        testOut.endpointType}
                    </span>
                  </div>
                  <div class="tr-row">
                    <span class="tr-k">结论</span>
                    <span class="tr-v">
                      <span class={`pill pill-${testOut.pass ? "ok" : "bad"}`}>
                        {testOut.pass ? "通过" : "未通过"}
                      </span>
                      <span class="muted" style="margin-left:8px">
                        {testOut.reason}
                      </span>
                    </span>
                  </div>
                  <div class="tr-row">
                    <span class="tr-k">耗时</span>
                    <span class="tr-v">{testOut.latencyMs} ms</span>
                  </div>
                  <div class="tr-row">
                    <span class="tr-k">提示词</span>
                    <span class="tr-v mono">{testOut.prompt || "—"}</span>
                  </div>
                  {testOut.imageLabel && (
                    <div class="tr-row">
                      <span class="tr-k">测试图</span>
                      <span class="tr-v">{testOut.imageLabel}</span>
                    </div>
                  )}
                  <div class="tr-row">
                    <span class="tr-k">回复</span>
                    <span class="tr-v mono">{testOut.reply || "（空）"}</span>
                  </div>
                  {testOut.toolCalls.length > 0 && (
                    <div class="tr-row">
                      <span class="tr-k">工具调用</span>
                      <span class="tr-v mono">
                        {testOut.toolCalls.map((c) =>
                          `${c.name}(${JSON.stringify(c.input)})`
                        ).join("; ")}
                      </span>
                    </div>
                  )}
                  {testOut.error && (
                    <div class="tr-row">
                      <span class="tr-k">错误</span>
                      <span class="tr-v mono" style="color:var(--bad)">
                        {testOut.error}
                      </span>
                    </div>
                  )}
                </div>
              )}
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={testOut === "loading"}
              onClick={onRunAgain}
            >
              {testOut === "loading" ? "测试中…" : "重新测试"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
