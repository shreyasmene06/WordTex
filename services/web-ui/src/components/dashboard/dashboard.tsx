"use client";

import React from "react";
import { useJobsStore, useUIStore } from "@/lib/stores";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConversionTelemetry } from "@/components/telemetry/conversion-telemetry";
import { DIRECTION_LABELS } from "@/lib/types";
import {
  Upload,
  ArrowRightLeft,
  Clock,
  CheckCircle2,
  TrendingUp,
  FileText,
} from "lucide-react";

export function Dashboard() {
  const { jobs } = useJobsStore();
  const { setView } = useUIStore();

  const completedJobs = jobs.filter((j) => j.status === "completed");
  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "processing"
  );
  const _failedJobs = jobs.filter((j) => j.status === "failed");

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Hero */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Your document conversion hub. Upload files, track progress, and
          download results.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Total Jobs"
          value={jobs.length}
          color="text-primary"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="In Progress"
          value={activeJobs.length}
          color="text-warning"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Completed"
          value={completedJobs.length}
          color="text-success"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Success Rate"
          value={
            jobs.length > 0
              ? `${Math.round((completedJobs.length / jobs.length) * 100)}%`
              : "—"
          }
          color="text-primary"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card
          className="cursor-pointer transition-all hover:border-primary/30 hover:shadow-md"
          onClick={() => setView("upload")}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
              <Upload className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">New Conversion</h3>
              <p className="text-sm text-muted-foreground">
                Upload a LaTeX, Word, or ZIP bundle
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-all hover:border-primary/30 hover:shadow-md"
          onClick={() => setView("upload")}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
              <ArrowRightLeft className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Round-Trip Test</h3>
              <p className="text-sm text-muted-foreground">
                Verify lossless LaTeX → Word → LaTeX
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Jobs */}
      {activeJobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Active Conversions</h2>
          {activeJobs.map((job) => (
            <ConversionTelemetry key={job.id} jobId={job.id} />
          ))}
        </div>
      )}

      {/* Recent Jobs */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Recent Jobs</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {jobs.slice(0, 10).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => {
                      useJobsStore.getState().setActiveJob(job.id);
                      setView("editor");
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          job.status === "completed"
                            ? "success"
                            : job.status === "failed"
                              ? "destructive"
                              : "warning"
                        }
                        className="text-[10px] min-w-[4.5rem] justify-center"
                      >
                        {job.status.toUpperCase()}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">
                          {job.sourceFilename}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {DIRECTION_LABELS[job.direction]}
                          {job.metrics
                            ? ` · ${(job.metrics.total_duration_ms / 1000).toFixed(1)}s`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {job.id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty State */}
      {jobs.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold">No conversions yet</h3>
              <p className="text-sm text-muted-foreground">
                Get started by uploading your first document.
              </p>
            </div>
            <Button onClick={() => setView("upload")}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className={`${color}`}>{icon}</span>
          <span className="text-2xl font-bold">{value}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
