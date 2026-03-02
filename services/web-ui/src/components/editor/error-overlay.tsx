"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Wrench,
  ImageIcon,
  SkipForward,
  X,
  ChevronRight,
} from "lucide-react";

export interface ConversionError {
  id: string;
  type: "undefined_macro" | "complex_construct" | "missing_package" | "parse_error";
  message: string;
  sourceLine?: number;
  sourceColumn?: number;
  sourceSnippet?: string;
  macroName?: string;
  suggestions: ErrorSuggestion[];
}

export interface ErrorSuggestion {
  id: string;
  strategy: "auto_fix" | "svg_fallback" | "ignore";
  label: string;
  description: string;
  replacementCode?: string;
}

interface ErrorOverlayProps {
  errors: ConversionError[];
  onResolve: (errorId: string, suggestionId: string) => void;
  onDismiss: (errorId: string) => void;
  onDismissAll: () => void;
}

const STRATEGY_CONFIG = {
  auto_fix: {
    icon: Wrench,
    color: "text-primary",
    bgColor: "bg-primary/10 border-primary/20",
    label: "Auto-Fix",
  },
  svg_fallback: {
    icon: ImageIcon,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    label: "SVG Fallback",
  },
  ignore: {
    icon: SkipForward,
    color: "text-muted-foreground",
    bgColor: "bg-muted border-border",
    label: "Ignore",
  },
};

const ERROR_TYPE_LABELS: Record<string, string> = {
  undefined_macro: "Undefined Macro",
  complex_construct: "Complex Construct",
  missing_package: "Missing Package",
  parse_error: "Parse Error",
};

export function ErrorResolutionOverlay({
  errors,
  onResolve,
  onDismiss,
  onDismissAll,
}: ErrorOverlayProps) {
  if (errors.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="text-sm font-medium">
            {errors.length} issue{errors.length !== 1 ? "s" : ""} found
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismissAll}>
          Dismiss All
        </Button>
      </div>

      {/* Error Cards */}
      <AnimatePresence mode="popLayout">
        {errors.map((error) => (
          <ErrorCard
            key={error.id}
            error={error}
            onResolve={onResolve}
            onDismiss={onDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ErrorCard({
  error,
  onResolve,
  onDismiss,
}: {
  error: ConversionError;
  onResolve: (errorId: string, suggestionId: string) => void;
  onDismiss: (errorId: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, height: 0 }}
      className="rounded-lg border border-destructive/20 bg-destructive/5 overflow-hidden"
    >
      {/* Error Header */}
      <div className="flex items-start justify-between p-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="text-[10px]">
              {ERROR_TYPE_LABELS[error.type] ?? error.type}
            </Badge>
            {error.sourceLine && (
              <span className="text-[10px] text-muted-foreground">
                Line {error.sourceLine}
                {error.sourceColumn ? `:${error.sourceColumn}` : ""}
              </span>
            )}
          </div>
          <p className="text-sm">{error.message}</p>
        </div>
        <button
          onClick={() => onDismiss(error.id)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Source Snippet */}
      {error.sourceSnippet && (
        <div className="mx-3 mb-2 rounded-md bg-background/50 p-2 font-mono text-xs">
          <code className="text-destructive">{error.sourceSnippet}</code>
        </div>
      )}

      {/* Resolution Suggestions */}
      <div className="border-t border-destructive/10 bg-card/30 p-2 space-y-1.5">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
          Resolution Options
        </p>
        {error.suggestions.map((suggestion) => {
          const config = STRATEGY_CONFIG[suggestion.strategy];
          const Icon = config.icon;

          return (
            <button
              key={suggestion.id}
              onClick={() => onResolve(error.id, suggestion.id)}
              className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors hover:bg-muted/50 ${config.bgColor}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{suggestion.label}</span>
                  <Badge variant="outline" className="text-[9px]">
                    {config.label}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {suggestion.description}
                </p>
                {suggestion.replacementCode && (
                  <code className="mt-1 block text-[10px] font-mono text-primary truncate">
                    {suggestion.replacementCode}
                  </code>
                )}
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
