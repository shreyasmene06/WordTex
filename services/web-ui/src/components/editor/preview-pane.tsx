"use client";

import React from "react";
import { useEditorStore, useJobsStore } from "@/lib/stores";
import { useDownloadResult } from "@/lib/hooks";
import {
  Loader2,
  Download,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPane() {
  const { previewUrl, downloadUrl } = useEditorStore();
  const { jobs, activeJobId } = useJobsStore();
  const activeJob = jobs.find((j) => j.id === activeJobId);
  const downloadMutation = useDownloadResult();

  const isCompleted = activeJob?.status === "completed";
  const isFailed = activeJob?.status === "failed";
  const isProcessing =
    activeJob?.status === "processing" || activeJob?.status === "queued";
  const isPdf = activeJob?.outputFilename?.endsWith(".pdf");

  // Error state — compilation failed
  if (isFailed && !previewUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">Compilation Failed</p>
          <p className="text-sm text-muted-foreground/70">
            {activeJob?.error ?? "The LaTeX engine returned an error. Check your source for issues."}
          </p>
        </div>
      </div>
    );
  }

  // PDF preview — full-pane native PDF viewer (like Overleaf)
  if (previewUrl) {
    return (
      <div className="relative flex h-full flex-col">
        {/* Full-height PDF embed — browser's native viewer handles zoom, pages, search */}
        <div className="relative flex-1">
          {isProcessing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 rounded-lg bg-card/90 px-6 py-4 shadow-lg">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm font-medium text-muted-foreground">Recompiling…</span>
              </div>
            </div>
          )}
          <iframe
            key={previewUrl}
            src={previewUrl}
            className="h-full w-full border-0"
            title="PDF Preview"
          />
        </div>
      </div>
    );
  }

  // Non-PDF completed job (e.g. DOCX) — offer download
  if (isCompleted && !isPdf && downloadUrl && activeJob) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-900/30">
          <FileText className="h-10 w-10 text-green-600 dark:text-green-400" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">Conversion Complete</p>
          <p className="text-sm text-muted-foreground">
            Your document has been converted to {activeJob.outputFilename ?? "DOCX"}.
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2"
          onClick={() => downloadMutation.mutate(activeJob.id)}
          disabled={downloadMutation.isPending}
        >
          <Download className="h-4 w-4" />
          {downloadMutation.isPending
            ? "Downloading…"
            : `Download ${activeJob.outputFilename ?? "document.docx"}`}
        </Button>
      </div>
    );
  }

  // Default: no preview yet
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
        {isProcessing ? (
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        ) : (
          <FileText className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">
          {isProcessing ? "Compiling…" : "No Preview Available"}
        </p>
        <p className="text-sm text-muted-foreground/70">
          {isProcessing
            ? "The PDF will appear here once the compilation completes."
            : "Start typing LaTeX to trigger a compilation, or click Re-run."}
        </p>
      </div>
    </div>
  );
}
