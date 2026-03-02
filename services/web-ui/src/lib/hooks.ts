import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  submitConversion,
  getJobStatus,
  cancelJob,
  downloadResult,
  listTemplates,
  getTemplate,
  healthCheck,
} from "./api";
import { useJobsStore } from "./stores";
import type { ConversionOptions } from "./types";

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
    onSuccess: () => {
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
