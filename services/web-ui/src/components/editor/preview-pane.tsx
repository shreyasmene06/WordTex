"use client";

import React, { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/stores";
import { Loader2, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPane() {
  const { previewUrl } = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [isLoading, setIsLoading] = useState(false);

  // For the MVP, we render the preview as an iframe / embedded view.
  // Phase 4 will swap this with a custom WebGL-accelerated PDF.js renderer.

  useEffect(() => {
    if (previewUrl) {
      setIsLoading(true);
    }
  }, [previewUrl]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 300));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 25));
  const handleZoomReset = () => setZoom(100);

  if (!previewUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
          <svg
            className="h-10 w-10 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="8" y2="9" />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">No Preview Available</p>
          <p className="text-sm text-muted-foreground/70">
            Submit a conversion to see the rendered output here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* Toolbar */}
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

      {/* Preview Content */}
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
            style={{
              width: "8.5in",
              height: "11in",
              border: "none",
            }}
            onLoad={() => setIsLoading(false)}
            title="Document Preview"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
