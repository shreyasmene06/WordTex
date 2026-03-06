"use client";

import React, { useEffect, useRef } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import { SourceEditor } from "./source-editor";
import { PreviewPane } from "./preview-pane";
import { EditorToolbar } from "./editor-toolbar";
import { useEditorStore } from "@/lib/stores";
import { useSubmitConversion } from "@/lib/hooks";
import { GripVertical } from "lucide-react";

export function SplitPaneEditor() {
  const { isEditorVisible, isPreviewVisible, sourceContent } = useEditorStore();
  const submitMutation = useSubmitConversion();
  const lastCompiledContent = useRef<string | null>(null);
  const mutateRef = useRef(submitMutation.mutate);
  mutateRef.current = submitMutation.mutate;

  // Auto-compile on debounce (Overleaf-style live preview)
  useEffect(() => {
    if (!sourceContent) return;
    if (sourceContent === lastCompiledContent.current) return;

    const timeoutId = setTimeout(() => {
      lastCompiledContent.current = sourceContent;
      const file = new File([sourceContent], "document.tex", { type: "text/plain" });
      mutateRef.current({
        file,
        options: { direction: "latex_to_pdf" },
      });
    }, 2500);

    return () => clearTimeout(timeoutId);
  }, [sourceContent]);

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar />

      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" autoSaveId="wordtex-editor">
          {isEditorVisible && (
            <>
              <Panel
                defaultSize={50}
                minSize={25}
                id="source"
                order={1}
              >
                <div className="h-full border-r border-border">
                  <div className="flex h-8 items-center border-b border-border bg-card/30 px-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      Source
                    </span>
                  </div>
                  <div className="h-[calc(100%-2rem)]">
                    <SourceEditor />
                  </div>
                </div>
              </Panel>

              {isPreviewVisible && (
                <PanelResizeHandle className="group relative flex w-1.5 items-center justify-center bg-border/50 transition-colors hover:bg-primary/30 active:bg-primary/50">
                  <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </PanelResizeHandle>
              )}
            </>
          )}

          {isPreviewVisible && (
            <Panel
              defaultSize={50}
              minSize={25}
              id="preview"
              order={2}
            >
              <div className="h-full">
                <div className="flex h-8 items-center border-b border-border bg-card/30 px-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Preview
                  </span>
                </div>
                <div className="h-[calc(100%-2rem)]">
                  <PreviewPane />
                </div>
              </div>
            </Panel>
          )}
        </PanelGroup>
      </div>
    </div>
  );
}
