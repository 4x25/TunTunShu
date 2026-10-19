// 模型指纹检测的纯数据类型。
// 算法与参考数据来自 Ikaleio/lm-detector(MIT),详见 data/fingerprint/README.md。

export interface FingerprintBankModel {
  id: string;
  display_name: string;
  family: string;
  family_name: string;
  response_count: number;
}

export interface FingerprintBank {
  schema: string;
  built_at: string;
  reference_sha256?: string;
  models: FingerprintBankModel[];
}

export interface Challenge {
  id: string;
  expected_count: number;
  prompt: string;
}

export interface Output {
  text: string;
  expected_count: number;
}

export type Vector = number[];
export type Matrix = Vector[];

export interface FeatureStats {
  mean: Vector;
  scale: Vector;
}

export type Preprocessing = FeatureStats[];

export interface FeatureBank {
  feature_mean: Vector;
  feature_scale: Vector;
  nuisance_basis: Matrix;
  centroids: Matrix;
}

export interface PositionalHead {
  params: FeatureStats[];
  weights: Matrix;
  bias: Vector;
}

export interface DetectorCalibration {
  schema: "shared-confidence-v2";
  method: "ranking-temperature";
  tau: number;
  binding: {
    base_sha256: string;
    reference_sha256: string;
    model_ids: string[];
  };
  calibration_run: string;
}

export interface SharedDetector {
  schema: "shared-detector-v2";
  source_run: string;
  base_sha256: string;
  source_reference_sha256: string;
  bank_built_at: string;
  model_ids: string[];
  response_counts: number[];
  calibration_sha256?: string | null;
  calibration?: DetectorCalibration | null;
  ranker: {
    head_params: Preprocessing;
    full_params: Preprocessing;
    lda_weights: Matrix;
    lda_bias: Vector;
    references: Matrix[];
    bank: {
      hellinger: FeatureBank;
      ordered_blocks: FeatureBank & { environment_centroids: Matrix[] };
    };
    blend: { frequency: number; positional: number };
    positional: PositionalHead;
  };
}

export type FingerprintDecision =
  | "prediction"
  | "partial"
  | "not_model"
  | "unscorable";

export interface AnalysisDiagnostic {
  index: number;
  parsed_numbers: number;
  minimum_numbers: number;
  accepted: boolean;
  raw_out_of_range_count: number;
}

export interface AnalysisSequence {
  autocorrelation: number;
  small_step_share: number;
  model_like: boolean;
}

export interface AnalysisEvidence {
  insufficient: boolean;
  label: string;
  reason: string;
  threshold: number | null;
  method: string;
}

export interface AnalysisCandidate {
  model: string;
  display_name: string;
  family: string;
  family_name: string;
  score: number;
  probability: number | null;
}

export interface Analysis {
  prediction: string;
  prediction_name: string;
  probability: number | null;
  probability_status?: string;
  probability_scope?: string | null;
  used_outputs: number;
  results: AnalysisCandidate[];
  diagnostics: AnalysisDiagnostic[];
  sequence: AnalysisSequence | null;
  family_prediction_name: string;
  ranking_score?: number;
  decision?: FingerprintDecision;
  evidence: AnalysisEvidence;
  method?: string;
  model_version?: { base_sha256: string };
  calibration?: unknown;
}
