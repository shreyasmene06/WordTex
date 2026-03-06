"use client";

import React from "react";
import { useEditorStore, useJobsStore } from "@/lib/stores";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Code2,
  Eye,
  Columns2,
  AlignJustify,
  Minus,
  Plus,
  Download,
  RotateCcw,
} from "lucide-react";
import { useDownloadResult, useSubmitConversion, useDownloadDocx } from "@/lib/hooks";
import { STAGE_LABELS } from "@/lib/types";

export function EditorToolbar() {
  const {
    sourceContent,
    isEditorVisible,
    isPreviewVisible,
    editorFontSize,
    isSyncScrollEnabled,
    toggleEditor,
    togglePreview,
    setEditorFontSize,
    setSyncScroll,
  } = useEditorStore();

  const { jobs, activeJobId } = useJobsStore();
  const activeJob = jobs.find((j) => j.id === activeJobId);
  const downloadMutation = useDownloadResult();
  const submitMutation = useSubmitConversion();
  const docxMutation = useDownloadDocx();

  return (
    <div className="flex h-10 items-center justify-between border-b border-border bg-card/50 px-2">
      {/* Left: View toggles */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isEditorVisible && !isPreviewVisible ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (!isEditorVisible) toggleEditor();
                if (isPreviewVisible) togglePreview();
              }}
            >
              <Code2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Source Only</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isEditorVisible && isPreviewVisible ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (!isEditorVisible) toggleEditor();
                if (!isPreviewVisible) togglePreview();
              }}
            >
              <Columns2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Split View</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={!isEditorVisible && isPreviewVisible ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (isEditorVisible) toggleEditor();
                if (!isPreviewVisible) togglePreview();
              }}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Preview Only</TooltipContent>
        </Tooltip>

        <div className="mx-2 h-4 w-px bg-border" />

        {/* Font size controls */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setEditorFontSize(Math.max(10, editorFontSize - 1))}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="min-w-[2rem] text-center text-xs text-muted-foreground">
            {editorFontSize}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setEditorFontSize(Math.min(24, editorFontSize + 1))}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        <div className="mx-2 h-4 w-px bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isSyncScrollEnabled ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setSyncScroll(!isSyncScrollEnabled)}
            >
              <AlignJustify className="h-3 w-3" />
              Sync
            </Button>
          </TooltipTrigger>
          <TooltipContent>Synchronized scrolling</TooltipContent>
        </Tooltip>
      </div>

      {/* Center: Job status */}
      {activeJob && (
        <div className="flex items-center gap-2">
          {activeJob.status === "processing" && (
            <Badge variant="warning" className="gap-1 text-[10px]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {STAGE_LABELS[activeJob.currentStage ?? "processing"] ??
                activeJob.currentStage}
            </Badge>
          )}
          {activeJob.status === "completed" && (
            <Badge variant="success" className="text-[10px]">
              Complete
            </Badge>
          )}
          {activeJob.status === "failed" && (
            <Badge variant="destructive" className="text-[10px]">
              Failed
            </Badge>
          )}
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={!sourceContent || docxMutation.isPending}
              onClick={() => {
                if (!sourceContent) return;
                docxMutation.mutate({
                  source: sourceContent,
                  filename: "document.tex",
                });
              }}
            >
              <Download className="h-3 w-3" />
              {docxMutation.isPending ? "Converting…" : "Download .docx"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Convert to Word and download</TooltipContent>
        </Tooltip>

        {activeJob?.status === "completed" && activeJob.outputFilename?.endsWith(".pdf") && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => downloadMutation.mutate(activeJob.id)}
            disabled={downloadMutation.isPending}
          >
            <Download className="h-3 w-3" />
            {downloadMutation.isPending ? "…" : "Download .pdf"}
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={submitMutation.isPending}
              onClick={() => {
                if (!sourceContent) return;
                const file = new File([sourceContent], "document.tex", { type: "text/plain" });
                submitMutation.mutate({
                  file,
                  options: { direction: "latex_to_pdf" },
                });
              }}
            >
              <RotateCcw className={`h-3.5 w-3.5 ${submitMutation.isPending ? "animate-spin" : ""}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Re-run conversion</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
