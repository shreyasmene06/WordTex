"use client";

import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, FileArchive, X, File } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatBytes, isSupportedFile, isLatexFile, isWordFile } from "@/lib/utils";
import { useUploadStore } from "@/lib/stores";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function getFileIcon(name: string) {
  if (isLatexFile(name)) return <FileText className="h-5 w-5 text-emerald-400" />;
  if (isWordFile(name)) return <File className="h-5 w-5 text-blue-400" />;
  if (name.endsWith(".zip")) return <FileArchive className="h-5 w-5 text-amber-400" />;
  return <FileText className="h-5 w-5 text-muted-foreground" />;
}

export function UploadZone() {
  const { files, addFiles, removeFile, clearFiles } = useUploadStore();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const valid = acceptedFiles.filter(
        (f) => isSupportedFile(f.name) && f.size <= MAX_FILE_SIZE
      );
      if (valid.length > 0) {
        addFiles(valid);
      }
    },
    [addFiles]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: {
        "application/x-tex": [".tex", ".latex", ".ltx"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          [".docx"],
        "application/msword": [".doc"],
        "application/zip": [".zip"],
        "image/*": [".png", ".jpg", ".jpeg", ".svg", ".eps", ".pdf"],
        "application/x-bibtex": [".bib"],
        "text/plain": [".sty", ".cls", ".bst"],
      },
      maxSize: MAX_FILE_SIZE,
      multiple: true,
    });

  const mainFile = files.find((f) => f.type === "main");
  const additionalFiles = files.filter((f) => f.type === "additional");

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={cn(
          "relative flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-300",
          isDragActive && !isDragReject
            ? "border-primary bg-primary/5 glow-primary"
            : isDragReject
              ? "border-destructive bg-destructive/5"
              : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"
        )}
      >
        <input {...getInputProps()} />

        <motion.div
          initial={false}
          animate={{
            scale: isDragActive ? 1.05 : 1,
            y: isDragActive ? -4 : 0,
          }}
          className="flex flex-col items-center gap-4 p-8 text-center"
        >
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-2xl transition-colors",
              isDragActive
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Upload className="h-8 w-8" />
          </div>

          <div className="space-y-2">
            <p className="text-lg font-medium">
              {isDragActive
                ? "Drop your files here"
                : "Drag & drop your documents"}
            </p>
            <p className="text-sm text-muted-foreground">
              Supports <span className="font-medium text-emerald-400">.tex</span>,{" "}
              <span className="font-medium text-blue-400">.docx</span>,{" "}
              <span className="font-medium text-amber-400">.zip</span> bundles
              (up to 100MB)
            </p>
            <p className="text-xs text-muted-foreground/70">
              ZIP bundles can include images, .bib, .sty, and .cls files
            </p>
          </div>

          <Button variant="outline" size="sm" className="mt-2">
            Or browse files
          </Button>
        </motion.div>
      </div>

      {/* File List */}
      <AnimatePresence mode="popLayout">
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">
                {files.length} file{files.length !== 1 ? "s" : ""} selected
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFiles();
                }}
              >
                Clear all
              </Button>
            </div>

            <div className="space-y-1.5">
              {/* Main file */}
              {mainFile && (
                <FileItem
                  key={mainFile.id}
                  file={mainFile}
                  onRemove={removeFile}
                  isMain
                />
              )}

              {/* Additional files */}
              {additionalFiles.map((f) => (
                <FileItem key={f.id} file={f} onRemove={removeFile} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileItem({
  file,
  onRemove,
  isMain = false,
}: {
  file: import("@/lib/types").UploadedFile;
  onRemove: (id: string) => void;
  isMain?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
        isMain ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      )}
    >
      {getFileIcon(file.name)}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
      {isMain && (
        <Badge variant="default" className="text-[10px]">
          PRIMARY
        </Badge>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(file.id);
        }}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
