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
  [key: string]: unknown;
}
