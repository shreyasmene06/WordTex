"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, useJobsStore } from "@/lib/stores";
import { useDownloadResult } from "@/lib/hooks";
import { latexToHtml } from "@/lib/latex-to-html";
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPane() {
  const { previewUrl, sourceContent, sourceLanguage } = useEditorStore();
  const { jobs, activeJobId } = useJobsStore();
  const activeJob = jobs.find((j) => j.id === activeJobId);
  const downloadMutation = useDownloadResult();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [isLoading, setIsLoading] = useState(false);

  const isPdf = activeJob?.outputFilename?.endsWith(".pdf");
  const isCompleted = activeJob?.status === "completed";
  const isProcessing =
    activeJob?.status === "processing" || activeJob?.status === "queued";

  // Build an HTML preview blob URL from the LaTeX source
  const htmlPreviewUrl = useMemo(() => {
    if (!sourceContent || sourceLanguage !== "latex") return null;
    const html = latexToHtml(sourceContent);
    const blob = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [sourceContent, sourceLanguage]);

  // Clean up blob URL on unmount / change
  useEffect(() => {
    return () => {
      if (htmlPreviewUrl) URL.revokeObjectURL(htmlPreviewUrl);
    };
  }, [htmlPreviewUrl]);

  useEffect(() => {
    if (previewUrl) {
      setIsLoading(true);
    }
  }, [previewUrl]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 300));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 25));
  const handleZoomReset = () => setZoom(100);

  // For completed .docx jobs, show the HTML rendering with a download bar
  if (isCompleted && !isPdf && htmlPreviewUrl) {
    return (
      <div ref={containerRef} className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-card/50 px-3 py-1.5">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleZoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              onClick={handleZoomReset}
              className="min-w-[3rem] rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {zoom}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleZoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 text-xs"
            onClick={() => activeJob && downloadMutation.mutate(activeJob.id)}
            disabled={downloadMutation.isPending}
          >
            <Download className="h-3.5 w-3.5" />
            {downloadMutation.isPending
              ? "Downloading…"
              : `Download ${activeJob?.outputFilename ?? ".docx"}`}
          </Button>
        </div>

        {/* Preview iframe */}
        <div className="relative flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-900">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          <div
            className="flex justify-center p-4"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
            }}
          >
            <iframe
              src={htmlPreviewUrl}
              className="bg-white shadow-2xl"
              style={{ width: "8.5in", height: "11in", border: "none" }}
              onLoad={() => setIsLoading(false)}
              title="Document Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    );
  }

  // For PDF previews we can embed them in an iframe
  if (isCompleted && isPdf && previewUrl) {
    return (
      <div ref={containerRef} className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border bg-card/50 px-3 py-1.5">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleZoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              onClick={handleZoomReset}
              className="min-w-[3rem] rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {zoom}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleZoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="relative flex-1 overflow-auto bg-neutral-900">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          <div
            className="flex justify-center p-4"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
            }}
          >
            <iframe
              src={previewUrl}
              className="bg-white shadow-2xl"
              style={{ width: "8.5in", height: "11in", border: "none" }}
              onLoad={() => setIsLoading(false)}
              title="Document Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    );
  }

  // Live preview while converting (show formatted source)
  if (isProcessing && htmlPreviewUrl) {
    return (
      <div ref={containerRef} className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border bg-card/50 px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Converting — preview is a rendering of your source
          </div>
        </div>
        <div className="relative flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-900">
          <div className="flex justify-center p-4">
            <iframe
              src={htmlPreviewUrl}
              className="bg-white shadow-2xl"
              style={{ width: "8.5in", height: "11in", border: "none" }}
              title="Source Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    );
  }

  // Default: no preview yet
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
        <FileText className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">
          {isProcessing ? "Converting…" : "No Preview Available"}
        </p>
        <p className="text-sm text-muted-foreground/70">
          {isProcessing
            ? "The output will appear here once the conversion completes."
            : "Submit a conversion to see the rendered output here."}
        </p>
      </div>
      {isProcessing && (
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      )}
    </div>
  );
}
