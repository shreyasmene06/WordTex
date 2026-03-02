"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTemplates } from "@/lib/hooks";
import { useUIStore, useUploadStore } from "@/lib/stores";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Check, FileText, Loader2 } from "lucide-react";
import type { TemplateInfo } from "@/lib/types";

// Template preview thumbnails (stylized representations)
const TEMPLATE_PREVIEWS: Record<string, { color: string; layout: string }> = {
  ieeetran: { color: "from-blue-600 to-blue-800", layout: "two-column" },
  acmart: { color: "from-purple-600 to-purple-800", layout: "two-column" },
  elsarticle: { color: "from-emerald-600 to-emerald-800", layout: "single" },
  revtex: { color: "from-orange-600 to-orange-800", layout: "single" },
  llncs: { color: "from-cyan-600 to-cyan-800", layout: "single" },
  article: { color: "from-gray-600 to-gray-800", layout: "single" },
};

function TemplatePreviewCard({
  template,
  isSelected,
  onSelect,
}: {
  template: TemplateInfo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const preview = TEMPLATE_PREVIEWS[template.name] ?? {
    color: "from-gray-600 to-gray-800",
    layout: "single",
  };

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      <Card
        className={`cursor-pointer overflow-hidden transition-all ${
          isSelected
            ? "ring-2 ring-primary glow-primary"
            : "hover:border-muted-foreground/30"
        }`}
        onClick={onSelect}
      >
        {/* Miniature preview */}
        <div
          className={`relative h-40 bg-gradient-to-br ${preview.color} p-4`}
        >
          <div className="mx-auto h-full w-full max-w-[180px] rounded-sm bg-white/90 p-2 shadow-md">
            {/* Simulated document layout */}
            <div className="space-y-1">
              <div className="mx-auto h-1.5 w-3/4 rounded-full bg-gray-800" />
              <div className="mx-auto h-1 w-1/2 rounded-full bg-gray-400" />
              <div className="h-0.5" />
              {preview.layout === "two-column" ? (
                <div className="flex gap-1">
                  <div className="flex-1 space-y-0.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-0.5 rounded-full bg-gray-300"
                        style={{ width: `${70 + Math.random() * 30}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex-1 space-y-0.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-0.5 rounded-full bg-gray-300"
                        style={{ width: `${70 + Math.random() * 30}%` }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-0.5 rounded-full bg-gray-300"
                      style={{ width: `${80 + Math.random() * 20}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Selected indicator */}
          {isSelected && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            >
              <Check className="h-4 w-4" />
            </motion.div>
          )}
        </div>

        <CardContent className="p-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{template.display_name}</h3>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {template.description}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              {template.publishers.map((p) => (
                <Badge key={p} variant="secondary" className="text-[10px]">
                  {p}
                </Badge>
              ))}
              <Badge variant="outline" className="text-[10px]">
                {template.latex_class}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function TemplateGallery() {
  const { isTemplateGalleryOpen, setTemplateGalleryOpen, selectedTemplate, setSelectedTemplate } =
    useUIStore();
  const { setTemplateOverride } = useUploadStore();
  const { data, isLoading } = useTemplates();

  const handleSelectTemplate = (name: string) => {
    const newSelection = selectedTemplate === name ? null : name;
    setSelectedTemplate(newSelection);
  };

  const handleApply = () => {
    setTemplateOverride(selectedTemplate);
    setTemplateGalleryOpen(false);
  };

  return (
    <AnimatePresence>
      {isTemplateGalleryOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setTemplateGalleryOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-4 max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-6">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">Template Gallery</h2>
                <p className="text-sm text-muted-foreground">
                  Choose an academic format. Your content and equations remain
                  unchanged.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTemplateGalleryOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Template Grid */}
            <div className="max-h-[55vh] overflow-y-auto p-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data?.templates.map((template) => (
                    <TemplatePreviewCard
                      key={template.name}
                      template={template}
                      isSelected={selectedTemplate === template.name}
                      onSelect={() => handleSelectTemplate(template.name)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {selectedTemplate
                  ? `Selected: ${data?.templates.find((t) => t.name === selectedTemplate)?.display_name}`
                  : "No template selected (auto-detect)"}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setTemplateGalleryOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleApply}>
                  Apply Template
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
