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
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  /** true when the response was truncated (hit max_tokens) */
  truncated: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolUseResult {
  toolCalls: ToolCall[];
  thinking?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  truncated: boolean;
}

/**
 * Handler for resolving tool calls. Given a tool call, returns the result string.
 * If not provided, all tool calls are acknowledged with "Recorded.".
 */
export type ToolHandler = (call: ToolCall) => string;

export interface SemanticClient {
  provider: ProviderKind;
  analyze(prompt: string): Promise<AnalyzeResult>;
  analyzeWithTools(opts: {
    system: string;
    userMessage: string;
    tools: ToolDefinition[];
    toolHandler?: ToolHandler;
  }): Promise<ToolUseResult>;
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
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
        durationMs,
        truncated,
      };
    },

    async analyzeWithTools(opts): Promise<ToolUseResult> {
      const start = Date.now();
      const messages: any[] = [{ role: "user", content: opts.userMessage }];
      const allToolCalls: ToolCall[] = [];
      let totalIn = 0;
      let totalOut = 0;
      let totalCacheRead = 0;
      let totalCacheCreation = 0;
      let thinking: string | undefined;
      let truncated = false;

      // mark system prompt and last tool as cacheable (ADR-026)
      const cachedSystem = [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }];
      const cachedTools = opts.tools.map((t: any, i: number) =>
        i === opts.tools.length - 1
          ? { ...t, cache_control: { type: "ephemeral" } }
          : t
      );

      // multi-turn loop: keep going while model wants to use tools
      for (;;) {
        const response = await messenger.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: cachedSystem,
          messages,
          tools: cachedTools,
        });

        totalIn += response.usage?.input_tokens ?? 0;
        totalOut += response.usage?.output_tokens ?? 0;
        totalCacheRead += response.usage?.cache_read_input_tokens ?? 0;
        totalCacheCreation += response.usage?.cache_creation_input_tokens ?? 0;
        truncated = response.stop_reason === "max_tokens";

        // extract thinking from first turn
        if (!thinking) {
          const tb = response.content.find((b: any) => b.type === "thinking");
          if (tb) thinking = tb.thinking as string;
        }

        // collect tool_use blocks
        const toolUseBlocks = response.content.filter(
          (b: any) => b.type === "tool_use"
        );
        for (const block of toolUseBlocks) {
          allToolCalls.push({ name: block.name, input: block.input });
        }

        // if model stopped (end_turn) or no tool calls, we're done
        if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
          break;
        }

        // send tool_result responses to continue the conversation
        const handler = opts.toolHandler ?? (() => "Recorded.");
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: [
            ...toolUseBlocks.map((b: any) => ({
              type: "tool_result",
              tool_use_id: b.id,
              content: handler({ name: b.name, input: b.input }),
            })),
            { type: "text", text: ".", cache_control: { type: "ephemeral" } },
          ],
        });
      }

      return {
        toolCalls: allToolCalls,
        thinking,
        inputTokens: totalIn,
        outputTokens: totalOut,
        cacheReadTokens: totalCacheRead,
        cacheCreationTokens: totalCacheCreation,
        durationMs: Date.now() - start,
        truncated,
      };
    },
  };
}

/**
 * Create a semantic client by detecting available credentials.
 *
 * Environment variables:
 *   LIGARE_ANTHROPIC_KEY  → Anthropic API (direct)
 *   AWS_REGION               → AWS Bedrock (uses default AWS credential chain)
 *   CLOUD_ML_REGION +
 *   ANTHROPIC_VERTEX_PROJECT → Google Vertex AI
 *
 *   LIGARE_COMPATIBLE_KEY  → Anthropic-compatible API (e.g. MiniMax)
 *   LIGARE_COMPATIBLE_URL → base URL for compatible API (e.g. https://api.minimaxi.com/anthropic)
 *
 *   LIGARE_MODEL          → override model id for any provider
 *   LIGARE_PROVIDER       → force a specific provider ("anthropic" | "bedrock" | "vertex" | "compatible")
 */
export function createSemanticClient(): SemanticClient | null {
  const forced = process.env.LIGARE_PROVIDER as ProviderKind | undefined;
  const modelOverride = process.env.LIGARE_MODEL;

  // forced provider
  if (forced === "anthropic") {
    const apiKey = process.env.LIGARE_ANTHROPIC_KEY;
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
    const apiKey = process.env.LIGARE_COMPATIBLE_KEY;
    const baseURL = process.env.LIGARE_COMPATIBLE_URL;
    if (!apiKey || !baseURL) return null;
    if (!modelOverride) return null; // compatible providers require explicit model
    return buildClient(
      new Anthropic({ apiKey, baseURL }),
      modelOverride,
      "compatible"
    );
  }

  // auto-detect: Anthropic → Bedrock → Vertex → Compatible
  const apiKey = process.env.LIGARE_ANTHROPIC_KEY;
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

  const compatKey = process.env.LIGARE_COMPATIBLE_KEY;
  const compatURL = process.env.LIGARE_COMPATIBLE_URL;
  if (compatKey && compatURL && modelOverride) {
    return buildClient(
      new Anthropic({ apiKey: compatKey, baseURL: compatURL }),
      modelOverride,
      "compatible"
    );
  }

  return null;
}
