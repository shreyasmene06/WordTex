"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore, useJobsStore } from "@/lib/stores";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DIRECTION_LABELS, STAGE_LABELS } from "@/lib/types";
import {
  FolderOpen,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { isSidebarOpen, setView } = useUIStore();
  const { jobs, activeJobId, setActiveJob } = useJobsStore();

  return (
    <AnimatePresence initial={false}>
      {isSidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="shrink-0 overflow-hidden border-r border-border bg-card/30"
        >
          <div className="flex h-full w-[280px] flex-col">
            {/* Projects header */}
            <div className="flex items-center justify-between border-b border-border p-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Jobs</span>
                {jobs.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {jobs.length}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setView("upload")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Job list */}
            <div className="flex-1 overflow-y-auto p-2">
              {jobs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                  <Clock className="h-8 w-8 opacity-40" />
                  <p className="text-xs">No conversions yet</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setView("upload")}
                  >
                    Start your first conversion
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => {
                        setActiveJob(job.id);
                        setView("editor");
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors",
                        activeJobId === job.id
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-muted/50"
                      )}
                    >
                      {/* Status icon */}
                      <div className="shrink-0">
                        {job.status === "processing" || job.status === "queued" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : job.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </div>

                      {/* Job info */}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">
                          {job.sourceFilename}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {DIRECTION_LABELS[job.direction]}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ·
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(job.createdAt, {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                        {job.status === "processing" && job.currentStage && (
                          <p className="text-[10px] text-primary truncate mt-0.5">
                            {STAGE_LABELS[job.currentStage] ??
                              job.currentStage}
                          </p>
                        )}
                      </div>

                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
