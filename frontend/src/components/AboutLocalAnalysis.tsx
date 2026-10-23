import { BookOpen } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { usePwa } from "@/lib/pwa";
import { EMAIL_RULES, RULE_SET_VERSION, URL_RULES, THRESHOLDS } from "@/lib/localAnalysis";

/** Unobtrusive explainer for the deterministic engine. Collapsed by default. */
export function AboutLocalAnalysis() {
  const pwa = usePwa();
  const rules = [...Object.values(URL_RULES), ...Object.values(EMAIL_RULES)];
  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink sm:px-5">
          <BookOpen className="h-4 w-4 text-faint" aria-hidden />About local analysis
          <span className="ml-auto font-mono text-2xs text-faint">{RULE_SET_VERSION}</span>
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-3 text-xs leading-relaxed text-muted sm:px-5">
          <p>When the backend cannot be reached, ThreatLens runs a small rule engine inside your browser. Each rule looks at the URL text or the email you provide, adds or subtracts a documented number of points, and the clamped sum is shown as a <strong className="text-ink">heuristic risk score (0-100)</strong>. {THRESHOLDS.higherRisk}+ is HIGHER RISK, {THRESHOLDS.suspicious}+ is SUSPICIOUS, anything lower is INSUFFICIENT EVIDENCE.</p>
          <p>The same input and rule-set version always give the same result. Nothing is sent to a server, no domain is contacted, and no randomness or clock is involved. The score is <strong className="text-ink">not a probability</strong> and has not been validated against a labelled dataset. A low score never means a URL or message is safe.</p>
          <p>Threat intelligence uses an optional bundled snapshot only. Without one the state is UNKNOWN. Offline use: {pwa.offlineReady ? "this app is cached and can reopen without a connection." : pwa.supported ? "the app caches itself after the first full load; until then it needs a connection." : "service workers are unavailable in this context."}</p>
          <details>
            <summary className="cursor-pointer text-ink/90">Rule table ({rules.length})</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-2xs">
                <thead className="text-faint"><tr><th className="py-1 pr-3">Rule</th><th className="pr-3">Weight</th><th className="pr-3">What it checks</th><th>Cannot establish</th></tr></thead>
                <tbody className="align-top">{rules.map((r) => (
                  <tr key={r.id} className="border-t border-line"><td className="py-1.5 pr-3 font-mono text-ink">{r.id}</td><td className="pr-3 font-mono">{r.weight > 0 ? `+${r.weight}` : r.weight}</td><td className="pr-3">{r.description}</td><td>{r.limitation}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </div>
      </details>
    </Card>
  );
}
