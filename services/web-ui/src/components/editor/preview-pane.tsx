"use client";

import React, { useEffect, useRef, useState } from "react";
import { useEditorStore, useJobsStore } from "@/lib/stores";
import { useDownloadResult } from "@/lib/hooks";
import { Loader2, ZoomIn, ZoomOut, Maximize2, Download, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPane() {
  const { previewUrl } = useEditorStore();
  const { jobs, activeJobId } = useJobsStore();
  const activeJob = jobs.find((j) => j.id === activeJobId);
  const downloadMutation = useDownloadResult();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [isLoading, setIsLoading] = useState(false);

  const isPdf = activeJob?.outputFilename?.endsWith(".pdf");
  const isCompleted = activeJob?.status === "completed";

  useEffect(() => {
    if (previewUrl) {
      setIsLoading(true);
    }
  }, [previewUrl]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 300));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 25));
  const handleZoomReset = () => setZoom(100);

  // For completed non-PDF jobs (e.g. .docx), show a success + download panel
  if (isCompleted && !isPdf) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-success/20">
          <CheckCircle2 className="h-10 w-10 text-success" />
        </div>
        <div className="space-y-2">
          <p className="text-lg font-semibold">Conversion Complete</p>
          <p className="text-sm text-muted-foreground">
            Your file has been converted to{" "}
            <span className="font-medium text-foreground">
              {activeJob.outputFilename ?? "Word document"}
            </span>
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2"
          onClick={() => activeJob && downloadMutation.mutate(activeJob.id)}
          disabled={downloadMutation.isPending}
        >
          <Download className="h-4 w-4" />
          {downloadMutation.isPending
            ? "Downloading…"
            : `Download ${activeJob.outputFilename ?? "Result"}`}
        </Button>
        <p className="text-xs text-muted-foreground/60">
          .docx preview is not available in the browser — open the file in Word, Google Docs, or LibreOffice.
        </p>
      </div>
    );
  }

  // For PDF previews we can embed them in an iframe
  if (isCompleted && isPdf && previewUrl) {
    return (
      <div ref={containerRef} className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border bg-card/50 px-3 py-1.5">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              onClick={handleZoomReset}
              className="min-w-[3rem] rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {zoom}%
            </button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn}>
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
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
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

  // Default: no preview yet
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
        <FileText className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">
          {activeJob?.status === "processing" || activeJob?.status === "queued"
            ? "Converting…"
            : "No Preview Available"}
        </p>
        <p className="text-sm text-muted-foreground/70">
          {activeJob?.status === "processing" || activeJob?.status === "queued"
            ? "The output will appear here once the conversion completes."
            : "Submit a conversion to see the rendered output here."}
        </p>
      </div>
      {(activeJob?.status === "processing" || activeJob?.status === "queued") && (
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      )}
    </div>
  );
}
