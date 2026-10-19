import { EndpointIcon } from "../brand_icons.tsx";
import classNames from "classnames";
import { IconClose } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { ENDPOINT_LABELS } from "./constants.ts";
import {
  fingerprintConfidenceLevel,
  fingerprintDecisionLabel,
  formatFingerprintBankDate,
  formatFingerprintPercent,
  formatFingerprintScore,
  isLowConfidence,
  sameModelName,
} from "./fingerprint.ts";
import type {
  FingerprintCandidate,
  FingerprintResult,
  FingerprintSample,
  FingerprintView,
} from "./types.ts";

function barWidth(probability: number | null): number {
  if (probability === null || !Number.isFinite(probability)) return 0;
  return Math.max(0, Math.min(100, probability * 100));
}

function CandidateRow(
  { candidate, rank }: { candidate: FingerprintCandidate; rank: number },
) {
  const level = fingerprintConfidenceLevel(candidate.probability);
  return (
    <div class="fp-candidate">
      <span class="fp-rank">{rank}</span>
      <span class="fp-candidate-name">
        {candidate.displayName}
        <span class="fp-candidate-family">{candidate.familyName}</span>
      </span>
      <span class="fp-bar">
        <span
          class={classNames("fp-bar-fill", `fp-bar-${level}`)}
          style={{ width: `${barWidth(candidate.probability)}%` }}
        />
      </span>
      <span class="fp-pct">
        {candidate.probability === null
          ? formatFingerprintScore(candidate.score)
          : formatFingerprintPercent(candidate.probability)}
      </span>
    </div>
  );
}

function SampleRow({ sample }: { sample: FingerprintSample }) {
  const status = sample.accepted ? "有效" : "无效";
  return (
    <div class="fp-sample">
      <span
        class={classNames("pill", {
          "pill-ok": sample.accepted,
          "pill-mute": !sample.accepted,
        })}
      >
        {status}
      </span>
      <span class="fp-sample-title">样本 {sample.index + 1}</span>
      <span class="fp-sample-nums">
        {sample.usedNumbers}/{sample.expectedCount}
      </span>
      <span class="fp-sample-min">最低 {sample.minimumNumbers}</span>
      {sample.parsedNumbers > sample.usedNumbers && !sample.capped && (
        <span class="tag">解析 {sample.parsedNumbers} · 已截取</span>
      )}
      {sample.capped && <span class="tag">达到目标后截断</span>}
      {sample.anomalous && <span class="tag tag-warn">分布异常</span>}
      {sample.rawOutOfRangeCount > 0 && (
        <span class="tag">越界 {sample.rawOutOfRangeCount}</span>
      )}
      {sample.error && <span class="fp-sample-err">{sample.error}</span>}
    </div>
  );
}

export function FingerprintResultModal(
  { view, out, onClose, onRunAgain }: {
    view: FingerprintView | null;
    out: FingerprintResult | "loading" | null;
    onClose: () => void;
    onRunAgain: () => void;
  },
) {
  const loading = out === "loading" || out === null;
  const confidenceLevel = out && out !== "loading"
    ? fingerprintConfidenceLevel(out.probability)
    : "empty";
  const confidencePill = confidenceLevel === "empty"
    ? "pill-mute"
    : `pill-${confidenceLevel}`;
  return (
    <Modal open={view !== null} onClose={onClose} wide>
      {view && (
        <>
          <div class="modal-head">
            <h3>模型指纹验证 · {view.name}</h3>
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
            {loading || out === null
              ? (
                <div class="fp-loading">
                  <span class="btn-spinner"></span>
                  <div>
                    <div>验证中…</div>
                    <div class="muted">
                      正在向上游发起 3 次采样，可能需要 1–2 分钟
                    </div>
                  </div>
                </div>
              )
              : (
                <div class="fp-result">
                  {out.error && out.samples.length === 0
                    ? (
                      <div class="fp-alert fp-alert-bad">
                        {out.error}
                      </div>
                    )
                    : (
                      <>
                        {out.error && (
                          <div class="fp-alert fp-alert-bad">
                            {out.error}
                          </div>
                        )}
                        <div class="fp-hero">
                          <div class="fp-hero-main">
                            <div class="fp-kicker">
                              {fingerprintDecisionLabel(out.decision)}
                            </div>
                            <div class="fp-prediction">
                              {out.predictionName || "—"}
                            </div>
                            <div class="fp-sub">
                              上游模型 {out.claimedModel}
                              {out.mappedModel
                                ? ` · 统一映射 ${out.mappedModel}`
                                : ""}
                              {out.familyName
                                ? ` · ${out.familyName} 家族`
                                : ""}
                            </div>
                            {out.decision === "prediction" &&
                              sameModelName(
                                out.claimedModel,
                                out.prediction,
                              ) && (
                              <span class="pill pill-ok fp-name-match">
                                名称一致
                              </span>
                            )}
                          </div>
                          <div class="fp-hero-score">
                            <span
                              class={classNames("pill", confidencePill)}
                            >
                              {formatFingerprintPercent(out.probability)}
                            </span>
                            <div class="fp-score-label">置信度</div>
                          </div>
                        </div>

                        {out.decision === "not_model" && (
                          <div class="fp-alert fp-alert-bad">
                            {out.evidence.reason}
                          </div>
                        )}
                        {out.decision === "unscorable" && (
                          <div class="fp-alert fp-alert-warn">
                            {out.evidence.reason}
                          </div>
                        )}
                        {out.decision === "partial" && (
                          <div class="fp-alert fp-alert-warn">
                            {out.evidence.reason}
                          </div>
                        )}
                        {isLowConfidence(out.probability) && (
                          <div class="fp-alert fp-alert-warn">
                            置信度低于 75%，结果仅供参考。
                          </div>
                        )}
                        {out.samples.some((sample) => sample.anomalous) && (
                          <div class="fp-alert fp-alert-warn">
                            样本 {out.samples
                              .filter((sample) => sample.anomalous)
                              .map((sample) => sample.index + 1)
                              .join("、")}{" "}
                            的最小值 ≥ 200，数字分布异常，结果可能不可靠。
                          </div>
                        )}

                        {out.results.length > 0 && (
                          <div class="fp-section">
                            <div class="fp-section-title">
                              候选排名
                              <span class="muted">
                                参考库内 {out.bankModelCount} 个模型
                              </span>
                            </div>
                            <div class="fp-candidates">
                              {out.results.slice(0, 5).map((
                                candidate,
                                index,
                              ) => (
                                <CandidateRow
                                  key={candidate.model}
                                  candidate={candidate}
                                  rank={index + 1}
                                />
                              ))}
                            </div>
                            {out.probability === null && (
                              <div class="fp-hint">
                                置信度不可用，右侧显示未校准的排名分数。
                              </div>
                            )}
                          </div>
                        )}

                        <div class="fp-section">
                          <div class="fp-section-title">
                            采样
                            <span class="muted">
                              有效 {out.usedOutputs}/3
                            </span>
                          </div>
                          <div class="fp-samples">
                            {out.samples.map((sample) => (
                              <SampleRow key={sample.index} sample={sample} />
                            ))}
                          </div>
                          <details class="fp-raw">
                            <summary>查看采样原文</summary>
                            <div class="fp-raw-list">
                              {out.samples.map((sample) => (
                                <div
                                  class="fp-raw-item"
                                  key={sample.index}
                                >
                                  <div class="fp-raw-head">
                                    样本 {sample.index + 1}
                                    {sample.accepted ? "" : " · 未采用"}
                                  </div>
                                  <pre>{sample.text || "（空）"}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>

                        <div class="fp-meta">
                          <span>
                            <EndpointIcon
                              type={out.endpointType}
                              class="brand-ico"
                            />
                            {ENDPOINT_LABELS[out.endpointType] ??
                              out.endpointType}
                          </span>
                          <span>耗时 {out.latencyMs} ms</span>
                          <span>
                            参考库 {formatFingerprintBankDate(out.bankBuiltAt)}
                          </span>
                        </div>
                      </>
                    )}

                  <p class="fp-note">
                    结果是参考库内的闭集排序，不是身份证明；库外模型也会得到“最接近”的候选。
                    算法与参考库来自{" "}
                    <a
                      href="https://github.com/Ikaleio/lm-detector"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      lm-detector
                    </a>
                    （MIT）。
                  </p>
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
              disabled={loading}
              onClick={onRunAgain}
            >
              {loading ? "验证中…" : "重新验证"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
