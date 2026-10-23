import { HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { Analyzed } from "@/lib/campaign/quality";

export function LocalStorageNote() {
  return (
    <p className="flex items-start gap-2 px-1 text-2xs leading-relaxed text-faint">
      <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      Saved campaign URLs are stored in this browser only (localStorage). They are not uploaded or synced. Use CSV export to back them up or move them.
    </p>
  );
}

export function QualityBadge({ status }: { status: Analyzed["status"] }) {
  return status === "ok" ? <Badge tone="accent">Clean</Badge> : status === "warn" ? <Badge tone="medium">Warnings</Badge> : <Badge tone="high">Errors</Badge>;
}
