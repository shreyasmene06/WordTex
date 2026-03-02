"use client";

import React from "react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { Dashboard } from "@/components/dashboard/dashboard";
import { UploadPanel } from "@/components/upload/upload-panel";
import { SplitPaneEditor } from "@/components/editor/split-pane-editor";
import { TemplateGallery } from "@/components/templates/template-gallery";
import { useUIStore } from "@/lib/stores";

export function AppShell() {
  const { currentView } = useUIStore();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-y-auto">
          {currentView === "dashboard" && <Dashboard />}

          {currentView === "upload" && (
            <div className="p-6">
              <UploadPanel />
            </div>
          )}

          {currentView === "editor" && <SplitPaneEditor />}
        </main>
      </div>

      {/* Global overlays */}
      <TemplateGallery />
    </div>
  );
}
