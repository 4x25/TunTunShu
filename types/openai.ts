export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: "list";
  data: OpenAIModel[];
}

export interface ChatCompletionRequest {
  model: string;
  messages?: unknown[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean } | null;
  [key: string]: unknown;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    code: string | null;
    param: string | null;
  };
}
