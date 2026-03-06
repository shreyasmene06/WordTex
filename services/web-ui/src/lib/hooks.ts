import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useCallback } from "react";
import {
  submitConversion,
  getJobStatus,
  cancelJob,
  downloadResult,
  listTemplates,
  getTemplate,
  healthCheck,
} from "./api";
import { useJobsStore, useEditorStore } from "./stores";
import type { ConversionOptions, ConversionJob } from "./types";

// ─── Conversion Hooks ───────────────────────────────────────────

export function useSubmitConversion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      file,
      options,
      additionalFiles,
    }: {
      file: File;
      options: ConversionOptions;
      additionalFiles?: File[];
    }) => submitConversion(file, options, additionalFiles),
    onSuccess: (data, variables) => {
      // Register the job in the store so JobPoller picks it up
      const { addJob, setActiveJob } = useJobsStore.getState();
      const job: ConversionJob = {
        id: data.job_id,
        direction: variables.options.direction,
        status: data.status,
        progress: 0,
        sourceFilename: variables.file.name,
        createdAt: new Date(),
      };
      addJob(job);
      setActiveJob(data.job_id);

      // Only clear preview when this is a PDF compile job
      // (don't clear it for a DOCX download job)
      if (variables.options.direction === "latex_to_pdf") {
        useEditorStore.getState().setPreviewUrl(null);
      }

      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useJobStatus(jobId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJobStatus(jobId!),
    enabled: !!jobId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        return false;
      }
      return 2000; // Poll every 2 seconds while processing
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => cancelJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
}

export function useDownloadResult() {
  return useMutation({
    mutationFn: (jobId: string) => downloadResult(jobId),
    onSuccess: (blob, jobId) => {
      // Use the outputFilename from the job store if available
      const { jobs } = useJobsStore.getState();
      const job = jobs.find((j) => j.id === jobId);
      const filename = job?.outputFilename ?? `wordtex-${jobId}.docx`;

      // Trigger browser download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
  });
}

// ─── Download DOCX Hook ─────────────────────────────────────────
// Self-contained: submit → poll → download.  Does NOT touch the
// active job or preview pane, so the PDF stays visible.

type DocxDownloadState = "idle" | "converting" | "downloading" | "done" | "error";

export function useDownloadDocx() {
  const stateRef = useRef<DocxDownloadState>("idle");
  const abortRef = useRef(false);

  const mutation = useMutation({
    mutationFn: async ({
      source,
      filename,
    }: {
      source: string;
      filename: string;
    }): Promise<void> => {
      stateRef.current = "converting";
      abortRef.current = false;

      // 1. Submit latex_to_word job
      const file = new File([source], filename, { type: "text/plain" });
      const { job_id } = await submitConversion(file, {
        direction: "latex_to_word",
      });

      // 2. Poll until terminal
      const TERMINAL = new Set(["completed", "failed", "cancelled"]);
      let status = "";
      let outputFilename = "";
      for (let i = 0; i < 120; i++) {
        if (abortRef.current) throw new Error("Cancelled");
        await new Promise((r) => setTimeout(r, 1_500));
        const res = await getJobStatus(job_id);
        status = res.status;
        outputFilename = res.output_filename ?? "";
        if (TERMINAL.has(status)) break;
      }

      if (status !== "completed") {
        throw new Error(`DOCX conversion ${status || "timed out"}`);
      }

      // 3. Download the blob and trigger browser save
      stateRef.current = "downloading";
      const blob = await downloadResult(job_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outputFilename || "document.docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      stateRef.current = "done";
    },
    onError: () => {
      stateRef.current = "error";
    },
  });

  const cancel = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { ...mutation, cancel, stateRef };
}

// ─── Template Hooks ─────────────────────────────────────────────

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
    staleTime: 5 * 60 * 1000, // Templates rarely change
    retry: 1,
    refetchOnMount: false,
  });
}

export function useTemplate(name: string | null) {
  return useQuery({
    queryKey: ["template", name],
    queryFn: () => getTemplate(name!),
    enabled: !!name,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Health Hook ────────────────────────────────────────────────

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: healthCheck,
    refetchInterval: 60_000, // Check once per minute
    retry: false, // Don't hammer when backend is offline
    staleTime: 30_000,
  });
}
