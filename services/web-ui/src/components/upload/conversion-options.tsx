"use client";

import React from "react";
import { useUploadStore } from "@/lib/stores";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DIRECTION_LABELS } from "@/lib/types";
import type { ConversionDirection } from "@/lib/types";
import { ArrowRightLeft, Settings2, Zap } from "lucide-react";

export function ConversionOptions() {
  const {
    direction,
    templateOverride,
    embedAnchors,
    svgFallbacks,
    pdfEngine,
    setDirection,
    setTemplateOverride,
    setEmbedAnchors,
    setSvgFallbacks,
    setPdfEngine,
  } = useUploadStore();

  return (
    <div className="space-y-6">
      {/* Direction Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-primary" />
          Conversion Direction
        </label>
        <Select
          value={direction}
          onValueChange={(v) => setDirection(v as ConversionDirection)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                <span className="flex items-center gap-2">
                  {label}
                  {value === "round_trip" && (
                    <Badge variant="warning" className="text-[10px]">
                      ADVANCED
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template Override */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          Template Override
        </label>
        <Select
          value={templateOverride ?? "auto"}
          onValueChange={(v) =>
            setTemplateOverride(v === "auto" ? null : v)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Auto-detect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect from source</SelectItem>
            <SelectItem value="ieeetran">IEEE Transactions</SelectItem>
            <SelectItem value="acmart">ACM Article</SelectItem>
            <SelectItem value="elsarticle">Elsevier Article</SelectItem>
            <SelectItem value="revtex">REVTeX (APS)</SelectItem>
            <SelectItem value="llncs">Springer LNCS</SelectItem>
            <SelectItem value="article">Standard Article</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* PDF Engine (only for PDF output) */}
      {(direction === "latex_to_pdf" || direction === "word_to_pdf") && (
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            PDF Engine
          </label>
          <Select
            value={pdfEngine}
            onValueChange={(v) =>
              setPdfEngine(v as "xelatex" | "lualatex" | "pdflatex")
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="xelatex">XeLaTeX (recommended)</SelectItem>
              <SelectItem value="lualatex">LuaLaTeX</SelectItem>
              <SelectItem value="pdflatex">pdfLaTeX</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Toggle Options */}
      <div className="space-y-3">
        <ToggleOption
          label="Embed Round-Trip Anchors"
          description="Embed original LaTeX AST as Custom XML Parts for lossless round-trips"
          checked={embedAnchors}
          onChange={setEmbedAnchors}
        />
        <ToggleOption
          label="SVG Fallbacks"
          description="Generate SVG graphics for complex constructs that can't be mapped semantically"
          checked={svgFallbacks}
          onChange={setSvgFallbacks}
        />
      </div>
    </div>
  );
}

function ToggleOption({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/30"
    >
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30"
        }`}
      >
        {checked && (
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
