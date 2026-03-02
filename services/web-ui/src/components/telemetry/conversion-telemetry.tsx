"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useJobsStore } from "@/lib/stores";
import { createProgressStream } from "@/lib/api";
import { useJobStatus } from "@/lib/hooks";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";

// Animated stage indicator icons
const STAGE_ICONS: Record<string, React.ReactNode> = {
  queued: <Clock className="h-3.5 w-3.5" />,
  parsing: <Activity className="h-3.5 w-3.5" />,
  sir_transform: <Activity className="h-3.5 w-3.5" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" />,
  failed: <XCircle className="h-3.5 w-3.5" />,
};

export function ConversionTelemetry({ jobId }: { jobId: string }) {
  const { handleProgressEvent, updateJob, jobs } = useJobsStore();
  const wsRef = useRef<WebSocket | null>(null);
  const job = jobs.find((j) => j.id === jobId);

  // Fallback: HTTP polling if WebSocket is unavailable
  const { data: polledStatus } = useJobStatus(jobId, true);

  // Update job from polling whenever we get data
  useEffect(() => {
    if (polledStatus) {
      updateJob(jobId, {
        status: polledStatus.status,
        progress: polledStatus.progress_percent,
        currentStage: polledStatus.current_stage,
        metrics: polledStatus.metrics ?? undefined,
        error: polledStatus.error ?? undefined,
        outputFilename: polledStatus.output_filename ?? undefined,
        ...(polledStatus.status === "completed" ? { completedAt: new Date() } : {}),
      });
    }
  }, [polledStatus, jobId, updateJob]);

  // Attempt WebSocket connection for real-time updates
  const connectWebSocket = useCallback(() => {
    try {
      const ws = createProgressStream(
        jobId,
        (event) => {
          handleProgressEvent(event);
        },
        () => {
          // On error, fall back to polling (already set up above)
          console.warn("WebSocket error, falling back to polling");
        },
        () => {
          wsRef.current = null;
        }
      );
      wsRef.current = ws;
    } catch {
      // WebSocket not available, polling will handle it
    }
  }, [jobId, handleProgressEvent]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  if (!job) return null;

  const isActive = job.status === "queued" || job.status === "processing";
  const stage = job.currentStage ?? job.status;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isActive ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : job.status === "completed" ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          <span className="font-medium text-sm">
            {job.sourceFilename}
          </span>
        </div>
        <Badge
          variant={
            job.status === "completed"
              ? "success"
              : job.status === "failed"
                ? "destructive"
                : "warning"
          }
          className="text-[10px]"
        >
          {job.status.toUpperCase()}
        </Badge>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="space-y-1.5">
          <Progress value={job.progress} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {STAGE_ICONS[stage] ?? <Activity className="h-3 w-3" />}
              {STAGE_LABELS[stage] ?? stage}
            </span>
            <span>{Math.round(job.progress)}%</span>
          </div>
        </div>
      )}

      {/* Stage Pipeline */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex gap-1 pt-1">
              {PIPELINE_STAGES.map((s) => {
                const stageIndex = PIPELINE_STAGES.indexOf(s);
                const currentIndex = PIPELINE_STAGES.indexOf(stage);
                const isPast = currentIndex > stageIndex;
                const isCurrent = s === stage;

                return (
                  <div
                    key={s}
                    className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                      isPast
                        ? "bg-primary"
                        : isCurrent
                          ? "bg-primary/60 animate-pulse"
                          : "bg-muted"
                    }`}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Metrics (after completion) */}
      {job.metrics && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <MetricCard label="Parse" value={formatDuration(job.metrics.parse_duration_ms)} />
          <MetricCard label="Transform" value={formatDuration(job.metrics.transform_duration_ms)} />
          <MetricCard label="Render" value={formatDuration(job.metrics.render_duration_ms)} />
        </div>
      )}

      {/* Error */}
      {job.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
          <p className="text-xs text-destructive">{job.error}</p>
        </div>
      )}
    </motion.div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-2 text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

const PIPELINE_STAGES = [
  "queued",
  "parsing",
  "macro_expansion",
  "sir_transform",
  "math_transform",
  "ooxml_generation",
  "pdf_render",
  "finalizing",
  "completed",
];
