// SPDX-License-Identifier: MIT

/**
 * StepFun Provider for Pi
 *
 * Copyright (c) 2026 Mark Gaiser <markg85@gmail.com>
 *
 * Registers the StepFun Step Plan API (https://api.stepfun.ai/step_plan/v1)
 * as a Pi provider. StepFun offers chat, vision, and reasoning models via an
 * OpenAI-compatible Chat Completions API.
 *
 * Models are discovered dynamically from the /v1/models endpoint at startup.
 * When the API is unreachable (no key, network error), a hardcoded fallback
 * list covers the models documented at
 * https://platform.stepfun.com/docs/zh/step-plan/overview
 *
 * Authentication (in priority order):
 *   1. /login stepfun — prompts for API key, stored in Pi's credential store
 *   2. STEPFUN_API_KEY env var
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.stepfun.ai/step_plan/v1";
const ENV_KEY = "STEPFUN_API_KEY";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RemoteModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  data: RemoteModel[];
}

// ---------------------------------------------------------------------------
// Heuristic model spec inference
// ---------------------------------------------------------------------------

/**
 * Infer model capabilities from the model ID naming conventions.
 *
 * Naming patterns (from StepFun docs / existing models):
 *   step-1-8k, step-1-32k          — legacy text-only models
 *   step-1v-*                       — vision models (text + image)
 *   step-2-16k                      — multimodal (text + image)
 *   step-3.x                        — multimodal (text + image)
 *   step-3.7-flash, step-3.5-flash  — multimodal + reasoning_effort support
 *   step-3.5-flash-2603             — multimodal + reasoning_effort (low/high)
 *   step-router-v1                  — routing model, text only
 *   stepaudio-*                      — audio models, skip for coding agent
 *   step-image-*                     — image gen models, skip for coding agent
 *   deepseek-*                       — deepseek models via step_plan
 */
function inferSpecs(id: string): {
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
} {
  const lower = id.toLowerCase();

  // Skip audio and image-gen models — not useful for a coding agent
  if (lower.startsWith("stepaudio-") || lower.startsWith("step-image-")) {
    return { reasoning: false, input: ["text"], contextWindow: 128_000, maxTokens: 8_192 };
  }

  // Reasoning models (support reasoning_effort parameter)
  const isReasoning =
    lower.includes("3.7") ||
    lower.includes("3.5-flash") ||
    lower === "step-3.7-flash" ||
    lower === "step-3.5-flash" ||
    lower === "step-3.5-flash-2603";

  const isRouter = lower === "step-router-v1";

  // Vision models: step-1v-*, step-2+*, step-3.x series
  const isVision =
    lower.startsWith("step-1v-") ||
    /^step-[2-9]/.test(lower) ||
    /^step-3/.test(lower);

  // Context window — from official docs (Step Plan reasoning models are 256K)
  // step-3.7-flash: 256K, step-3.5-flash: 256K, router (deepseek-v4-pro + step-3.5-flash): 256K
  let contextWindow = 128_000;
  if (isReasoning || isRouter) contextWindow = 256_000;
  else if (lower.includes("-8k")) contextWindow = 8_000;
  else if (lower.includes("-16k")) contextWindow = 16_000;
  else if (lower.includes("-32k")) contextWindow = 32_000;
  else if (lower.includes("-64k")) contextWindow = 64_000;
  else if (lower.includes("-128k")) contextWindow = 128_000;
  else if (lower.includes("-256k")) contextWindow = 256_000;
  const isTextOnly = lower === "step-router-v1" || /^step-1-/.test(lower);



  // Max output tokens heuristic
  let maxTokens = 8_192;
  if (lower.includes("deepseek-v4")) maxTokens = 16_384;
  else if (lower.includes("3.7") || lower.includes("3.5")) maxTokens = 16_384;
  else if (lower === "step-router-v1") maxTokens = 384_000;
  else if (isReasoning) maxTokens = 16_384;
  else if (isVision) maxTokens = 8_192;

  const input: ("text" | "image")[] = isTextOnly && !isVision ? ["text"] : ["text", "image"];

  return { reasoning: isReasoning, input, contextWindow, maxTokens };
}

// ---------------------------------------------------------------------------
// Fallback model list (used when /v1/models is unreachable)
// ---------------------------------------------------------------------------

const FALLBACK_MODELS: string[] = [
  // Flagship reasoning models
  "step-3.7-flash",
  "step-3.5-flash-2603",
  "step-3.5-flash",

  // Router
  "step-router-v1",

  // Legacy text models
  "step-1-8k",
  "step-1-32k",

  // Legacy vision models
  "step-1v-8k",
  "step-1v-32k",

  // Multimodal
  "step-2-16k",
];

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

async function fetchModels(apiKey?: string): Promise<RemoteModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(`${BASE_URL}/models`, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const payload = (await res.json()) as ModelsResponse;
      const models = payload.data ?? [];
      if (models.length > 0) return models;
    }
  } catch {
    // Network error or timeout — fall through to fallback
  }

  return [];
}

function buildModelList(remoteModels: RemoteModel[]) {
  // If we got models from the API, use them
  if (remoteModels.length > 0) {
    return remoteModels.map((m) => {
      const spec = inferSpecs(m.id);
      return {
        id: m.id,
        name: m.id,
        reasoning: spec.reasoning,
        input: spec.input as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: spec.contextWindow,
        maxTokens: spec.maxTokens,
      };
    });
  }

  // Fallback: hardcoded list from StepFun docs
  return FALLBACK_MODELS.map((id) => {
    const spec = inferSpecs(id);
    return {
      id,
      name: id,
      reasoning: spec.reasoning,
      input: spec.input as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: spec.contextWindow,
      maxTokens: spec.maxTokens,
    };
  });
}

// ---------------------------------------------------------------------------
// Main extension
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const envApiKey = process.env[ENV_KEY] || "";

  // Try fetching models from the API (with or without key)
  const remoteModels = await fetchModels(envApiKey || undefined);
  const models = buildModelList(remoteModels);

  pi.registerProvider("stepfun", {
    name: "StepFun",
    baseUrl: BASE_URL,
    apiKey: `$${ENV_KEY}`,
    api: "openai-completions",
    authHeader: true,
    models,

    oauth: {
      name: "StepFun",

      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const apiKey = await callbacks.onPrompt({
          message: "Enter your StepFun API key (from https://platform.stepfun.com/apikeys):",
        });

        if (!apiKey) throw new Error("Login cancelled");

        // Validate the key against the API
        const res = await fetch(`${BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          throw new Error(
            `API key validation failed (HTTP ${res.status}). Check your key at https://platform.stepfun.com/apikeys`
          );
        }

        // API keys don't expire — set far-future expiry
        const FAR_FUTURE = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;

        return {
          refresh: apiKey,
          access: apiKey,
          expires: FAR_FUTURE,
        };
      },

      async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
        // API keys don't expire — return as-is
        return credentials;
      },

      getApiKey(credentials: OAuthCredentials): string {
        return credentials.access;
      },
    },
  });
}
