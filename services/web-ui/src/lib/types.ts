// ─── Conversion API Types ────────────────────────────────────────
// Mirrors the Go API gateway types and proto definitions exactly.

export type ConversionDirection =
  | "latex_to_word"
  | "word_to_latex"
  | "latex_to_pdf"
  | "word_to_pdf"
  | "round_trip";

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ConversionOptions {
  direction: ConversionDirection;
  template_override?: string;
  embed_anchors?: boolean;
  svg_fallbacks?: boolean;
  pdf_engine?: "xelatex" | "lualatex" | "pdflatex";
}

export interface SubmitJobResponse {
  job_id: string;
  status: JobStatus;
  estimated_seconds?: number;
  message?: string;
}

export interface ConversionMetrics {
  parse_duration_ms: number;
  transform_duration_ms: number;
  render_duration_ms: number;
  total_duration_ms: number;
  blocks_processed: number;
  equations_processed: number;
  warnings?: string[];
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress_percent: number;
  current_stage?: string;
  error?: string;
  output_filename?: string;
  metrics?: ConversionMetrics;
}

export interface JobProgressEvent {
  job_id: string;
  status: JobStatus;
  progress_percent: number;
  stage: string;
  message: string;
}

// ─── Template API Types ──────────────────────────────────────────

export interface TemplateInfo {
  name: string;
  display_name: string;
  latex_class: string;
  dotx_file: string;
  publishers: string[];
  description: string;
}

export interface TemplateListResponse {
  templates: TemplateInfo[];
  count: number;
}

// ─── UI-Specific Types ──────────────────────────────────────────

export interface UploadedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: "main" | "additional";
  progress: number;
}

export interface ConversionJob {
  id: string;
  direction: ConversionDirection;
  status: JobStatus;
  progress: number;
  currentStage?: string;
  sourceFilename: string;
  template?: string;
  createdAt: Date;
  completedAt?: Date;
  metrics?: ConversionMetrics;
  error?: string;
  outputFilename?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  jobs: ConversionJob[];
}

// ─── Stage Display Mapping ──────────────────────────────────────

export const STAGE_LABELS: Record<string, string> = {
  queued: "Waiting in Queue",
  uploading: "Uploading File",
  parsing: "Parsing AST",
  macro_expansion: "Expanding Macros",
  sir_transform: "Building Semantic IR",
  resolving_bibliography: "Resolving Bibliographies",
  math_transform: "Transforming MathML",
  ooxml_generation: "Generating OOXML",
  latex_generation: "Generating LaTeX",
  pdf_render: "Rendering PDF Layout",
  anchor_embedding: "Embedding Anchor Metadata",
  svg_fallback: "Generating SVG Fallbacks",
  finalizing: "Finalizing Output",
  completed: "Complete",
  failed: "Failed",
};

export const DIRECTION_LABELS: Record<ConversionDirection, string> = {
  latex_to_word: "LaTeX → Word",
  word_to_latex: "Word → LaTeX",
  latex_to_pdf: "LaTeX → PDF",
  word_to_pdf: "Word → PDF",
  round_trip: "Round-Trip",
};
