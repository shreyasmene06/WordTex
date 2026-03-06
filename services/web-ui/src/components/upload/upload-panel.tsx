"use client";

import React from "react";
import { useUploadStore, useUIStore, useEditorStore } from "@/lib/stores";
import { useSubmitConversion } from "@/lib/hooks";
import { submitConversion } from "@/lib/api";
import { UploadZone } from "./upload-zone";
import { ConversionOptions } from "./conversion-options";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Rocket, Loader2 } from "lucide-react";

export function UploadPanel() {
  const {
    files,
    direction,
    templateOverride,
    embedAnchors,
    svgFallbacks,
    pdfEngine,
    isUploading,
    setUploading,
    clearFiles,
  } = useUploadStore();
  const { setView } = useUIStore();
  const { setSourceContent, setSourceLanguage } = useEditorStore();
  const submitMutation = useSubmitConversion();

  const mainFile = files.find((f) => f.type === "main");
  const additionals = files.filter((f) => f.type === "additional");
  const canSubmit = mainFile && !isUploading;

  async function handleSubmit() {
    if (!mainFile) return;

    setUploading(true);
    try {
      // If the user chose a non-PDF direction (e.g. latex_to_word),
      // fire both: the chosen conversion for download AND a
      // latex_to_pdf conversion for the live preview.
      const isLatexSource =
        mainFile.name.endsWith(".tex") ||
        mainFile.name.endsWith(".latex") ||
        direction.startsWith("latex");
      const needsSeparatePreview = direction !== "latex_to_pdf" && isLatexSource;

      // Fire the user's chosen conversion (registered by hook's onSuccess)
      const result = await submitMutation.mutateAsync({
        file: mainFile.file,
        options: {
          direction,
          template_override: templateOverride ?? undefined,
          embed_anchors: embedAnchors,
          svg_fallbacks: svgFallbacks,
          pdf_engine: pdfEngine,
        },
        additionalFiles: additionals.map((f) => f.file),
      });

      // Also fire a PDF preview job if the main conversion isn't PDF
      if (needsSeparatePreview) {
        submitMutation.mutate({
          file: mainFile.file,
          options: { direction: "latex_to_pdf", pdf_engine: pdfEngine },
          additionalFiles: additionals.map((f) => f.file),
        });
      }

      // Job is now automatically registered in the store by
      // the useSubmitConversion hook's onSuccess handler.

      // Load original file content into the source editor
      try {
        const text = await mainFile.file.text();
        setSourceContent(text);
        // Set the right language mode based on file/direction
        const isLatex =
          mainFile.name.endsWith(".tex") ||
          mainFile.name.endsWith(".latex") ||
          direction.startsWith("latex");
        setSourceLanguage(isLatex ? "latex" : "xml");
      } catch {
        // Non-text files (e.g. .docx) can't be read as text
      }

      // Transition to editor view
      clearFiles();
      setView("editor");
    } catch (error) {
      console.error("Submission failed:", error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Convert Your Document
        </h1>
        <p className="text-muted-foreground">
          Upload your LaTeX, Word, or ZIP project bundle for precision conversion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload Files</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadZone />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conversion Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <ConversionOptions />
        </CardContent>
      </Card>

      <Button
        size="xl"
        className="w-full"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {isUploading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Rocket className="h-5 w-5" />
            Start Conversion
          </>
        )}
      </Button>
    </div>
  );
}
