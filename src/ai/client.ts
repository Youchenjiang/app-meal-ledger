import { t } from "../i18n";
import { readAiConfig } from "./config";
import { supabase } from "../lib/supabase";

export type AiRequest = {
  system: string;
  user: string;
  imageDataUrl?: string;
};

export type AiResult = { ok: true; data: unknown } | { ok: false; message: string };

// Returns a fresh access token for the edge-function proxy, or an empty
// string when the user has no usable session. getUser validates the stored
// session against the auth server and refreshes the access token when it has
// expired, so the proxy never receives a stale bearer token.
async function currentAccessToken(): Promise<string> {
  if (!supabase) return "";
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return "";
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

// The Supabase API gateway requires the publishable (anon) key on
// /functions/v1/* routes before a request reaches the function body.
function publicApiKey(): string {
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
    ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
  return key?.trim() ?? "";
}

const REQUEST_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAiViaEdgeFunction(edgeFunctionUrl: string, request: AiRequest): Promise<unknown> {
  const token = await currentAccessToken();
  let response: Response;
  try {
    response = await fetchWithTimeout(edgeFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(publicApiKey() ? { apikey: publicApiKey() } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      system: request.system,
      user: request.user,
      imageDataUrl: request.imageDataUrl ?? undefined,
    }),
  });
  } catch {
    // The request never produced an HTTP response: the proxy is unreachable
    // (local Supabase down, or a misconfigured remote URL), or the gateway
    // dropped an error response before the browser could read it (which is
    // how a provider overload surfaces here after the proxy's retries). The
    // client cannot distinguish these, so stay honest and actionable.
    throw new Error(t("ai.unavailable"));
  }
  if (!response.ok) {
    // 401 means the proxy (or its gateway) rejected the request. Without a
    // session it wants a sign-in; with a session the stored token was
    // rejected (stale, or issued by a different Supabase instance). Give an
    // actionable message instead of a bare HTTP status.
    if (response.status === 401) {
      throw new Error(token
        ? t("ai.sessionExpired")
        : t("ai.loginRequired"));
    }
    throw new Error(t("ai.requestFailed", { status: response.status }));
  }
  const payload = (await response.json()) as { data?: unknown; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.data;
}

function extractImage(imageDataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(imageDataUrl);
  if (!match) {
    throw new Error(t("ai.imageUnreadable"));
  }
  return { mimeType: match[1], base64: match[2] };
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(t("ai.emptyResponse"));
  }
  return JSON.parse(stripMarkdownFence(trimmed));
}

// Removes ```json ... ``` fences when a provider wraps the JSON payload,
// supporting both multi-line and single-line fences. Returns the input
// unchanged when it is not fenced.
function stripMarkdownFence(text: string): string {
  if (!text.startsWith("```") || !text.endsWith("```")) {
    return text;
  }
  const firstLineEnd = text.indexOf("\n");
  let start = firstLineEnd + 1;
  if (firstLineEnd === -1) {
    // Single-line fence such as ```json {...} ``` or ```json{...}```.
    const brace = text.indexOf("{");
    start = brace === -1 ? text.indexOf(" ") + 1 : brace;
  }
  return text.slice(start, text.length - 3).trim();
}

async function requestOpenAi(baseUrl: string, apiKey: string, model: string, request: AiRequest): Promise<unknown> {
  const messages = [
    { role: "system", content: request.system },
    {
      role: "user",
      content: request.imageDataUrl
        ? [
            { type: "text", text: request.user },
            { type: "image_url", image_url: { url: request.imageDataUrl } },
          ]
        : request.user,
    },
  ];
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    throw new Error(t("ai.requestFailed", { status: response.status }));
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(t("ai.noContent"));
  }
  return parseJsonResponse(content);
}

async function requestGemini(baseUrl: string, apiKey: string, model: string, request: AiRequest): Promise<unknown> {
  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [{ text: request.user }];
  if (request.imageDataUrl) {
    const image = extractImage(request.imageDataUrl);
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  const response = await fetchWithTimeout(
    `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: request.system }] },
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(t("ai.requestFailed", { status: response.status }));
  }
  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new Error(t("ai.noContent"));
  }
  return parseJsonResponse(text);
}

export async function requestAiJson(request: AiRequest): Promise<AiResult> {
  const config = readAiConfig();
  if (!config) {
    return { ok: false, message: t("ai.notConfigured") };
  }
  try {
    if (config.edgeFunctionUrl) {
      const data = await requestAiViaEdgeFunction(config.edgeFunctionUrl, request);
      return { ok: true, data };
    }
    const { baseUrl } = config;
    // Vision requests (receipt/invoice photos) use a dedicated vision-capable
    // model when configured; text parsing keeps the fast default model.
    const model = request.imageDataUrl ? config.visionModel ?? config.model : config.model;
    const data = config.provider === "gemini"
      ? await requestGemini(baseUrl, config.apiKey, model, request)
      : await requestOpenAi(baseUrl, config.apiKey, model, request);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : t("ai.requestError") };
  }
}
