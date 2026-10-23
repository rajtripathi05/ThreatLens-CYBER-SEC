import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? "n/a" : `${(v * 100).toFixed(digits)}%`;
}
export function num(v: number | null | undefined, digits = 3): string {
  return v == null || Number.isNaN(v) ? "n/a" : v.toFixed(digits);
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function shortHash(h?: string | null, n = 10): string {
  return h ? `${h.slice(0, n)}…` : "n/a";
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Defang for safe display/copy: the URL must never become a live link. */
export function defang(u: string): string {
  return u.replace(/^http/i, "hxxp").replace(/\./g, "[.]");
}
