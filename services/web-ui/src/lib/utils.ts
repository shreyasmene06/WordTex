import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function getFileExtension(filename: string): string {
  return filename.slice(filename.lastIndexOf(".")).toLowerCase();
}

export function isLatexFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return [".tex", ".latex", ".ltx"].includes(ext);
}

export function isWordFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return [".docx", ".doc"].includes(ext);
}

export function isSupportedFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return [".tex", ".latex", ".ltx", ".docx", ".doc", ".zip"].includes(ext);
}
