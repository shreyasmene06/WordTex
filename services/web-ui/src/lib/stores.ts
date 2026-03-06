import { create } from "zustand";
import type {
  ConversionDirection,
  ConversionJob,
  JobProgressEvent,
  UploadedFile,
} from "@/lib/types";

// ─── Upload Store ───────────────────────────────────────────────

interface UploadState {
  files: UploadedFile[];
  direction: ConversionDirection;
  templateOverride: string | null;
  embedAnchors: boolean;
  svgFallbacks: boolean;
  pdfEngine: "xelatex" | "lualatex" | "pdflatex";
  isUploading: boolean;

  // Actions
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  setDirection: (d: ConversionDirection) => void;
  setTemplateOverride: (t: string | null) => void;
  setEmbedAnchors: (v: boolean) => void;
  setSvgFallbacks: (v: boolean) => void;
  setPdfEngine: (e: "xelatex" | "lualatex" | "pdflatex") => void;
  setUploading: (v: boolean) => void;
  updateFileProgress: (id: string, progress: number) => void;
}

let fileCounter = 0;

export const useUploadStore = create<UploadState>((set) => ({
  files: [],
  direction: "latex_to_word",
  templateOverride: null,
  embedAnchors: true,
  svgFallbacks: true,
  pdfEngine: "xelatex",
  isUploading: false,

  addFiles: (files) =>
    set((state) => ({
      files: [
        ...state.files,
        ...files.map((f, i) => ({
          id: `file-${++fileCounter}`,
          file: f,
          name: f.name,
          size: f.size,
          type: (i === 0 && state.files.length === 0
            ? "main"
            : "additional") as "main" | "additional",
          progress: 0,
        })),
      ],
    })),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
    })),

  clearFiles: () => set({ files: [] }),

  setDirection: (direction) => set({ direction }),
  setTemplateOverride: (templateOverride) => set({ templateOverride }),
  setEmbedAnchors: (embedAnchors) => set({ embedAnchors }),
  setSvgFallbacks: (svgFallbacks) => set({ svgFallbacks }),
  setPdfEngine: (pdfEngine) => set({ pdfEngine }),
  setUploading: (isUploading) => set({ isUploading }),

  updateFileProgress: (id, progress) =>
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, progress } : f)),
    })),
}));

// ─── Conversion Jobs Store ──────────────────────────────────────

interface JobsState {
  jobs: ConversionJob[];
  activeJobId: string | null;

  addJob: (job: ConversionJob) => void;
  updateJob: (id: string, updates: Partial<ConversionJob>) => void;
  removeJob: (id: string) => void;
  setActiveJob: (id: string | null) => void;
  handleProgressEvent: (event: JobProgressEvent) => void;
}

export const useJobsStore = create<JobsState>((set) => ({
  jobs: [],
  activeJobId: null,

  addJob: (job) =>
    set((state) => ({
      jobs: [job, ...state.jobs],
      activeJobId: job.id,
    })),

  updateJob: (id, updates) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
    })),

  removeJob: (id) =>
    set((state) => ({
      jobs: state.jobs.filter((j) => j.id !== id),
      activeJobId: state.activeJobId === id ? null : state.activeJobId,
    })),

  setActiveJob: (id) => set({ activeJobId: id }),

  handleProgressEvent: (event) =>
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === event.job_id
          ? {
              ...j,
              status: event.status,
              progress: event.progress_percent,
              currentStage: event.stage,
            }
          : j
      ),
    })),
}));

// ─── Editor Store ───────────────────────────────────────────────

interface EditorState {
  sourceContent: string;
  sourceLanguage: "latex" | "xml" | "json";
  previewUrl: string | null;
  downloadUrl: string | null;
  isSyncScrollEnabled: boolean;
  editorFontSize: number;
  isEditorVisible: boolean;
  isPreviewVisible: boolean;
  splitRatio: number;

  setSourceContent: (content: string) => void;
  setSourceLanguage: (lang: "latex" | "xml" | "json") => void;
  setPreviewUrl: (url: string | null) => void;
  setDownloadUrl: (url: string | null) => void;
  setSyncScroll: (v: boolean) => void;
  setEditorFontSize: (size: number) => void;
  toggleEditor: () => void;
  togglePreview: () => void;
  setSplitRatio: (ratio: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  sourceContent: "",
  sourceLanguage: "latex",
  previewUrl: null,
  downloadUrl: null,
  isSyncScrollEnabled: true,
  editorFontSize: 14,
  isEditorVisible: true,
  isPreviewVisible: true,
  splitRatio: 50,

  setSourceContent: (sourceContent) => set({ sourceContent }),
  setSourceLanguage: (sourceLanguage) => set({ sourceLanguage }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setDownloadUrl: (downloadUrl) => set({ downloadUrl }),
  setSyncScroll: (isSyncScrollEnabled) => set({ isSyncScrollEnabled }),
  setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
  toggleEditor: () =>
    set((state) => ({ isEditorVisible: !state.isEditorVisible })),
  togglePreview: () =>
    set((state) => ({ isPreviewVisible: !state.isPreviewVisible })),
  setSplitRatio: (splitRatio) => set({ splitRatio }),
}));

// ─── UI Store ───────────────────────────────────────────────────

type View = "dashboard" | "editor" | "upload";

interface UIState {
  currentView: View;
  isSidebarOpen: boolean;
  isTemplateGalleryOpen: boolean;
  selectedTemplate: string | null;

  setView: (view: View) => void;
  toggleSidebar: () => void;
  setTemplateGalleryOpen: (v: boolean) => void;
  setSelectedTemplate: (t: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  currentView: "dashboard",
  isSidebarOpen: true,
  isTemplateGalleryOpen: false,
  selectedTemplate: null,

  setView: (currentView) => set({ currentView }),
  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setTemplateGalleryOpen: (isTemplateGalleryOpen) =>
    set({ isTemplateGalleryOpen }),
  setSelectedTemplate: (selectedTemplate) => set({ selectedTemplate }),
}));
