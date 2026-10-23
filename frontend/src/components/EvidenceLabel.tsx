import { FlaskConical, Gauge, Sparkles, TestTube2 } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { ExperimentMetadata } from "@/lib/types";

export type LabelKind = "real" | "synthetic" | "oracle" | "fixture";

export const LABELS: Record<LabelKind, { text: string; tone: "accent" | "sim" | "medium" | "demo"; Icon: typeof FlaskConical; plain: string }> = {
  real: { text: "Real-data evaluation", tone: "accent", Icon: TestTube2,
    plain: "Measured on held-out URLs from the real PhiUSIIL dataset. It supports claims about URL strings in that dataset only." },
  synthetic: { text: "Synthetic simulation", tone: "sim", Icon: FlaskConical,
    plain: "The threat-intelligence feed was deliberately corrupted by the experiment (indicators deleted, false matches injected, matches shuffled). It tests a decision policy under control. It says nothing about any real provider." },
  oracle: { text: "Oracle upper bound", tone: "medium", Icon: Gauge,
    plain: "The simulated feed was built from the held-out test labels, so it is perfect wherever it has coverage. This is the best case, not independent threat intelligence and not a deployable defence." },
  fixture: { text: "Demo fixture", tone: "demo", Icon: Sparkles,
    plain: "Loaded from a file bundled with this site, not computed by a live service. Result files are copies of saved runs; analyses come from a synthetic demo model." },
};

export function EvidenceLabel({ kind }: { kind: LabelKind }) {
  const { text, tone, Icon } = LABELS[kind];
  return <Badge tone={tone} title={LABELS[kind].plain}><Icon className="h-3 w-3" aria-hidden />{text}</Badge>;
}

/** Labels that apply to a saved result set. Oracle sets get the oracle label, not just "simulation". */
export function labelsFor(m: ExperimentMetadata | undefined, demo: boolean): LabelKind[] {
  if (!m) return demo ? ["fixture"] : [];
  const base: LabelKind[] = m.kind === "real_data_classifier" ? ["real"] : m.feed_mode === "oracle_test_labels" ? ["oracle", "synthetic"] : ["synthetic"];
  return demo ? [...base, "fixture"] : base;
}

export function LabelStrip({ kinds }: { kinds: LabelKind[] }) {
  return <span className="inline-flex flex-wrap items-center gap-1.5">{kinds.map((k) => <EvidenceLabel key={k} kind={k} />)}</span>;
}

/** Plain-language key for the four labels. */
export function LabelLegend({ only }: { only?: LabelKind[] }) {
  const kinds = only ?? (["real", "synthetic", "oracle", "fixture"] as LabelKind[]);
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {kinds.map((k) => (
        <div key={k} className="rounded-md border border-line bg-bg/40 p-3">
          <dt><EvidenceLabel kind={k} /></dt>
          <dd className="mt-1.5 text-xs text-muted">{LABELS[k].plain}</dd>
        </div>
      ))}
    </dl>
  );
}
