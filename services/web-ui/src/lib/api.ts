import type {
  SubmitJobResponse,
  JobStatusResponse,
  TemplateListResponse,
  TemplateInfo,
  ConversionOptions,
} from "./types";

// All requests go through Next.js rewrites (see next.config.ts),
// so we use empty base — the rewrites proxy to the Go gateway.
// Auth is injected server-side by the Next.js middleware in
// src/middleware.ts, so browser-side requests don't need to
// carry the gateway token themselves.
const API_BASE = "";

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(`API Error ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

/**
 * Fetch a short-lived gateway JWT from the /api/token route.
 * Used only for paths that bypass the Next.js middleware (e.g. WebSocket).
 */
async function fetchGatewayToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/token");
    if (!res.ok) return null;
    const { token } = await res.json();
    return token ?? null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: HeadersInit = {
    ...options.headers,
  };

  // Don't set Content-Type for FormData (browser sets boundary automatically)
  if (!(options.body instanceof FormData)) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  // The Authorization header is injected by Next.js middleware for
  // proxied /api/v1/* requests, so we don't need to set it here.

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error || body.detail || detail;
    } catch {
      // Response body wasn't JSON
    }
    throw new ApiError(res.status, detail);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

// ─── Conversion Endpoints ───────────────────────────────────────

export async function submitConversion(
  file: File,
  options: ConversionOptions,
  additionalFiles?: File[]
): Promise<SubmitJobResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("direction", options.direction);

  if (options.template_override) {
    formData.append("template_override", options.template_override);
  }
  if (options.embed_anchors) {
    formData.append("embed_anchors", "true");
  }
  if (options.svg_fallbacks) {
    formData.append("svg_fallbacks", "true");
  }
  if (options.pdf_engine) {
    formData.append("pdf_engine", options.pdf_engine);
  }

  // Attach additional files (images, .bib, .sty, etc.)
  if (additionalFiles) {
    for (const af of additionalFiles) {
      formData.append("additional_files", af);
    }
  }

  return request<SubmitJobResponse>("/api/v1/convert", {
    method: "POST",
    body: formData,
  });
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/api/v1/jobs/${jobId}`);
}

export async function cancelJob(
  jobId: string
): Promise<{ job_id: string; status: string; message: string }> {
  return request(`/api/v1/jobs/${jobId}`, { method: "DELETE" });
}

export async function downloadResult(jobId: string): Promise<Blob> {
  const url = `${API_BASE}/api/v1/jobs/${jobId}/download`;

  // Auth header is injected by Next.js middleware
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(res.status, "Failed to download result");
  }
  return res.blob();
}

// ─── Template Endpoints ─────────────────────────────────────────

export async function listTemplates(): Promise<TemplateListResponse> {
  return request<TemplateListResponse>("/api/v1/templates");
}

export async function getTemplate(name: string): Promise<TemplateInfo> {
  return request<TemplateInfo>(`/api/v1/templates/${name}`);
}

// ─── WebSocket for Real-Time Progress ───────────────────────────

export async function createProgressStream(
  jobId: string,
  onEvent: (event: import("./types").JobProgressEvent) => void,
  onError?: (error: Event) => void,
  onClose?: () => void
): Promise<WebSocket> {
  const wsBase =
    process.env.NEXT_PUBLIC_WS_URL ||
    (typeof window !== "undefined"
      ? `ws://${window.location.host}`
      : "ws://localhost:8080");

  // WebSocket connections bypass Next.js middleware, so we need an
  // explicit gateway token fetched from the /api/token route.
  const token = (await fetchGatewayToken()) ?? "";
  const ws = new WebSocket(
    `${wsBase}/api/v1/jobs/${jobId}/progress?token=${token}`
  );

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch {
      console.error("Failed to parse progress event:", event.data);
    }
  };

  ws.onerror = (event) => onError?.(event);
  ws.onclose = () => onClose?.();

  return ws;
}

// ─── Health Check ───────────────────────────────────────────────

export async function healthCheck(): Promise<{
  status: string;
  service: string;
  version: string;
}> {
  return request("/health");
}

export { ApiError };
