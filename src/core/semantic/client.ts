/**
 * core/semantic/client.ts
 *
 * Provider-switching LLM client.
 * Detection order: Anthropic API key → AWS Bedrock → Google Vertex AI → Anthropic-compatible → null.
 * Returns null when no credentials are found (graceful degradation).
 */

import Anthropic from "@anthropic-ai/sdk";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import AnthropicVertex from "@anthropic-ai/vertex-sdk";

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514";
const BEDROCK_DEFAULT_MODEL = "anthropic.claude-sonnet-4-20250514-v1:0";
const VERTEX_DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT =
  "You are a software architecture analyst. You analyze Architecture Decision Records (ADRs) and source code modules to identify semantic relationships. You output ONLY valid JSON arrays. No explanation, no markdown fences, no preamble.";

export type ProviderKind = "anthropic" | "bedrock" | "vertex" | "compatible";

export interface AnalyzeResult {
  text: string;
  /** model's internal reasoning (thinking block), if present */
  thinking?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** true when the response was truncated (hit max_tokens) */
  truncated: boolean;
}

export interface SemanticClient {
  provider: ProviderKind;
  analyze(prompt: string): Promise<AnalyzeResult>;
}

function buildClient(
  messenger: { messages: { create(opts: any): Promise<any> } },
  model: string,
  provider: ProviderKind
): SemanticClient {
  return {
    provider,
    async analyze(prompt: string): Promise<AnalyzeResult> {
      const start = Date.now();
      const response = await messenger.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });
      const durationMs = Date.now() - start;
      const truncated = response.stop_reason === "max_tokens";
      // extract thinking and text blocks
      const thinkingBlock = response.content.find((b: any) => b.type === "thinking");
      const textBlock = response.content.find((b: any) => b.type === "text");
      const text = textBlock ? textBlock.text : "[]";
      const thinking = thinkingBlock?.thinking as string | undefined;
      return {
        text,
        thinking,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        durationMs,
        truncated,
      };
    },
  };
}

/**
 * Create a semantic client by detecting available credentials.
 *
 * Environment variables:
 *   ADR_GRAPH_ANTHROPIC_KEY  → Anthropic API (direct)
 *   AWS_REGION               → AWS Bedrock (uses default AWS credential chain)
 *   CLOUD_ML_REGION +
 *   ANTHROPIC_VERTEX_PROJECT → Google Vertex AI
 *
 *   ADR_GRAPH_COMPATIBLE_KEY  → Anthropic-compatible API (e.g. MiniMax)
 *   ADR_GRAPH_COMPATIBLE_URL → base URL for compatible API (e.g. https://api.minimaxi.com/anthropic)
 *
 *   ADR_GRAPH_MODEL          → override model id for any provider
 *   ADR_GRAPH_PROVIDER       → force a specific provider ("anthropic" | "bedrock" | "vertex" | "compatible")
 */
export function createSemanticClient(): SemanticClient | null {
  const forced = process.env.ADR_GRAPH_PROVIDER as ProviderKind | undefined;
  const modelOverride = process.env.ADR_GRAPH_MODEL;

  // forced provider
  if (forced === "anthropic") {
    const apiKey = process.env.ADR_GRAPH_ANTHROPIC_KEY;
    if (!apiKey) return null;
    return buildClient(
      new Anthropic({ apiKey }),
      modelOverride ?? ANTHROPIC_DEFAULT_MODEL,
      "anthropic"
    );
  }

  if (forced === "bedrock") {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    if (!region) return null;
    return buildClient(
      new AnthropicBedrock({ awsRegion: region }),
      modelOverride ?? BEDROCK_DEFAULT_MODEL,
      "bedrock"
    );
  }

  if (forced === "vertex") {
    const project = process.env.ANTHROPIC_VERTEX_PROJECT;
    const region = process.env.CLOUD_ML_REGION;
    if (!project || !region) return null;
    return buildClient(
      new AnthropicVertex({ projectId: project, region }),
      modelOverride ?? VERTEX_DEFAULT_MODEL,
      "vertex"
    );
  }

  if (forced === "compatible") {
    const apiKey = process.env.ADR_GRAPH_COMPATIBLE_KEY;
    const baseURL = process.env.ADR_GRAPH_COMPATIBLE_URL;
    if (!apiKey || !baseURL) return null;
    if (!modelOverride) return null; // compatible providers require explicit model
    return buildClient(
      new Anthropic({ apiKey, baseURL }),
      modelOverride,
      "compatible"
    );
  }

  // auto-detect: Anthropic → Bedrock → Vertex → Compatible
  const apiKey = process.env.ADR_GRAPH_ANTHROPIC_KEY;
  if (apiKey) {
    return buildClient(
      new Anthropic({ apiKey }),
      modelOverride ?? ANTHROPIC_DEFAULT_MODEL,
      "anthropic"
    );
  }

  const awsRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (awsRegion) {
    return buildClient(
      new AnthropicBedrock({ awsRegion }),
      modelOverride ?? BEDROCK_DEFAULT_MODEL,
      "bedrock"
    );
  }

  const vertexProject = process.env.ANTHROPIC_VERTEX_PROJECT;
  const vertexRegion = process.env.CLOUD_ML_REGION;
  if (vertexProject && vertexRegion) {
    return buildClient(
      new AnthropicVertex({ projectId: vertexProject, region: vertexRegion }),
      modelOverride ?? VERTEX_DEFAULT_MODEL,
      "vertex"
    );
  }

  const compatKey = process.env.ADR_GRAPH_COMPATIBLE_KEY;
  const compatURL = process.env.ADR_GRAPH_COMPATIBLE_URL;
  if (compatKey && compatURL && modelOverride) {
    return buildClient(
      new Anthropic({ apiKey: compatKey, baseURL: compatURL }),
      modelOverride,
      "compatible"
    );
  }

  return null;
}
