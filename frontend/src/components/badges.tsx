import { AlertOctagon, CircleHelp, CircleSlash, FlaskConical, Radio, SearchCheck, ShieldAlert, ShieldQuestion, Sparkles, TestTube2 } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { Decision, Severity, TIState } from "@/lib/types";

const DECISION: Record<Decision, { tone: "high" | "medium" | "low"; label: string; Icon: typeof ShieldAlert }> = {
  phishing: { tone: "high", label: "Likely phishing", Icon: ShieldAlert },
  review: { tone: "medium", label: "Needs review", Icon: ShieldQuestion },
  benign: { tone: "low", label: "No strong evidence", Icon: SearchCheck },
};
export function DecisionBadge({ decision }: { decision: Decision }) {
  const { tone, label, Icon } = DECISION[decision];
  return <Badge tone={tone}><Icon className="h-3 w-3" aria-hidden />{label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severity}>{severity}</Badge>;
}

const TI: Record<TIState, { tone: "high" | "medium" | "neutral" | "dashed" | "sim"; label: string; Icon: typeof AlertOctagon }> = {
  MATCH_FRESH: { tone: "high", label: "Match (fresh)", Icon: AlertOctagon },
  MATCH_STALE: { tone: "medium", label: "Match (stale)", Icon: AlertOctagon },
  SYNTHETIC_MATCH: { tone: "sim", label: "Synthetic match", Icon: FlaskConical },
  NO_MATCH: { tone: "neutral", label: "No match", Icon: CircleSlash },
  UNKNOWN: { tone: "dashed", label: "Unknown", Icon: CircleHelp },
};
export function TIBadge({ state }: { state: TIState }) {
  const { tone, label, Icon } = TI[state];
  return <Badge tone={tone} title={state}><Icon className="h-3 w-3" aria-hidden />{label}</Badge>;
}

/** Provenance of any number or chart. Synthetic simulation, empirical result and demo fixture must be visually distinct. */
export function SourceBadge({ kind }: { kind: "simulation" | "empirical" | "demo" | "live" }) {
  switch (kind) {
    case "simulation": return <Badge tone="sim"><FlaskConical className="h-3 w-3" aria-hidden />Simulation</Badge>;
    case "empirical": return <Badge tone="accent"><TestTube2 className="h-3 w-3" aria-hidden />Empirical · PhiUSIIL</Badge>;
    case "demo": return <Badge tone="demo"><Sparkles className="h-3 w-3" aria-hidden />Demo fixture</Badge>;
    case "live": return <Badge tone="accent"><Radio className="h-3 w-3" aria-hidden />Live API</Badge>;
  }
}

export function ScoreBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${label}: ${(v * 100).toFixed(0)} percent`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${v * 100}%` }} /></div>
      <span className="font-mono text-xs tabular-nums text-muted">{v.toFixed(2)}</span>
    </div>
  );
}
