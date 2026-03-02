"use client";

import React from "react";
import Link from "next/link";
import { useUIStore } from "@/lib/stores";
import { useHealth } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Menu,
  Upload,
  LayoutGrid,
  Palette,
  Wifi,
  WifiOff,
} from "lucide-react";

export function Header() {
  const { toggleSidebar, setView, setTemplateGalleryOpen } = useUIStore();
  const { data: health, isError } = useHealth();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/50 px-3">
      {/* Left */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleSidebar}
        >
          <Menu className="h-4 w-4" />
        </Button>

        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
            <span className="text-sm font-bold text-primary">W</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">WordTex</span>
        </Link>

        <Badge variant="secondary" className="text-[10px] font-normal">
          BETA
        </Badge>
      </div>

      {/* Center: Nav */}
      <nav className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setView("dashboard")}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Dashboard
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setView("upload")}
        >
          <Upload className="h-3.5 w-3.5" />
          New Conversion
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setTemplateGalleryOpen(true)}
        >
          <Palette className="h-3.5 w-3.5" />
          Templates
        </Button>
      </nav>

      {/* Right: Status */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {isError ? (
                <WifiOff className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-success" />
              )}
              <span className="text-[10px] text-muted-foreground">
                {health?.version ?? "offline"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {isError
              ? "API Gateway unreachable"
              : `Connected to API Gateway v${health?.version}`}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
