"use client";

import { useEffect, useRef, useCallback } from "react";
import { useJobsStore, useEditorStore } from "@/lib/stores";
import { getJobStatus, downloadResult } from "@/lib/api";
import type { JobStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 2_000;

const TERMINAL_STATES: Set<JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Invisible component that polls status for every non-terminal job
 * in the Zustand store and writes updates back.
 * Mount once at the app root so polling works in every view.
 */
export function JobPoller() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const { jobs, updateJob, activeJobId } = useJobsStore.getState();
    const active = jobs.filter((j) => !TERMINAL_STATES.has(j.status));
    if (active.length === 0) return;

    await Promise.allSettled(
      active.map(async (job) => {
        try {
          const res = await getJobStatus(job.id);
          const wasTerminal = TERMINAL_STATES.has(job.status);
          const nowTerminal = TERMINAL_STATES.has(res.status);

          updateJob(job.id, {
            status: res.status,
            progress: res.progress_percent,
            currentStage: res.current_stage,
            metrics: res.metrics ?? undefined,
            error: res.error ?? undefined,
            outputFilename: res.output_filename ?? undefined,
            ...(res.status === "completed" ? { completedAt: new Date() } : {}),
          });

          // When the active job just completed, fetch the output
          // and generate a preview blob URL.
          if (!wasTerminal && nowTerminal && res.status === "completed" && job.id === activeJobId) {
            try {
              const blob = await downloadResult(job.id);
              const url = URL.createObjectURL(blob);
              const filename = res.output_filename ?? "";

              if (filename.endsWith(".pdf")) {
                useEditorStore.getState().setPreviewUrl(url);
              } else {
                // For .docx and other non-embeddable formats, store the
                // blob URL so the preview pane can offer a download link.
                useEditorStore.getState().setPreviewUrl(url);
              }
            } catch {
              // Download failed — preview stays empty
            }
          }
        } catch {
          // Network hiccup — will retry on next tick
        }
      })
    );
  }, []);

  useEffect(() => {
    // Run immediately on mount, then every POLL_INTERVAL_MS
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  return null; // renders nothing
}
