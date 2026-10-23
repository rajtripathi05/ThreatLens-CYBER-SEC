import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { useApp } from "@/context/AppContext";
import { shortHash } from "@/lib/utils";

const COMMANDS: { label: string; cmd: string }[] = [
  { label: "Install & test", cmd: "pip install -r requirements.txt\npython -m pytest -q" },
  { label: "Download the dataset (UCI, id 967)", cmd: "python scripts/download_phiusiil.py" },
  { label: "Train the deployable URL model", cmd: "python -m src.train_model --csv data/raw/PhiUSIIL_Phishing_URL_Dataset.csv --url-col URL --label-col label --scheme uci" },
  { label: "Real-data classifier evaluation (empirical)", cmd: "python experiments/run_real_data.py" },
  { label: "Controlled TI-degradation simulations", cmd: "python experiments/run_experiments.py                                   # synthetic URLs\npython experiments/run_experiments.py --config experiments/configs/real_oracle.json\npython experiments/run_experiments.py --config experiments/configs/real_proxy.json" },
  { label: "Run the app", cmd: "uvicorn api.main:app --port 8000\nnpm --prefix frontend ci && npm --prefix frontend run dev" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <Card><CardHeader title={<span id={`${id}-h`}>{title}</span>} /><div className="card-pad space-y-3 text-sm leading-relaxed text-ink/90 [&_a]:text-accent [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink">{children}</div></Card>
    </section>
  );
}

function Cmd({ label, cmd }: { label: string; cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><p className="label">{label}</p>
        <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(cmd); setDone(true); setTimeout(() => setDone(false), 1500); }} aria-label={`Copy command: ${label}`}>
          {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}{done ? "Copied" : "Copy"}</Button></div>
      <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-ink">{cmd}</pre>
    </div>
  );
}

export default function Methodology() {
  const { status } = useApp();
  return (
    <>
      <PageHeader kicker="06 · Methods & provenance" title="Methodology & Data" description="Scope, provenance and limitations, so the results can be judged without reading the code." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block"><ul className="sticky top-20 space-y-1 text-sm">
          {[["rq", "Research question"], ["threat", "Threat model & scope"], ["data", "Dataset & licence"], ["model", "Model & scoring"], ["ti", "Threat intelligence"], ["email", "URL vs email"], ["exp", "Experiments"], ["repro", "Reproduce"], ["limits", "Limitations"]].map(([id, t]) =>
            <li key={id}><a href={`#${id}`} className="block rounded px-2 py-1 text-muted hover:bg-raised hover:text-ink">{t}</a></li>)}</ul></nav>

        <div className="min-w-0 space-y-5">
          <Section id="rq" title="Research question">
            <p><strong>How do missing or noisy threat-intelligence records affect phishing-URL triage, and can reliability-aware decision-making reduce incorrect high-risk decisions compared with naive fusion?</strong></p>
            <p>Working title: <em>Reliability-Aware Phishing URL Triage Under Degraded Threat Intelligence: An Empirical Evaluation</em>. No claim of novelty or publishability is made here; that requires a literature review that has not been done.</p>
          </Section>

          <Section id="threat" title="Threat model & scope">
            <ul>
              <li><strong>Defender task:</strong> triage a URL (or the URLs in an email) as likely phishing, needs human review, or no strong evidence.</li>
              <li><strong>Adversary:</strong> a phisher who registers look-alike or compromised hosts and sends links. Adaptive evasion against this specific model is out of scope and untested.</li>
              <li><strong>Inputs:</strong> URL strings and, optionally, a parsed .eml. <strong>No URL is fetched, resolved or opened</strong>, and no attachment is opened.</li>
              <li><strong>Out of scope:</strong> page content, redirects, TLS, domain age, live feeds, attachment analysis, email-body semantics.</li>
            </ul>
          </Section>

          <Section id="data" title="Dataset provenance & licence">
            <p><strong>PhiUSIIL Phishing URL (Website) Dataset</strong>, UCI Machine Learning Repository (id 967). Documented as 235,795 rows, 54 features, 134,850 legitimate and 100,945 phishing URLs. Licence <strong>CC BY 4.0</strong> (attribution required).</p>
            <p>Citation: Prasad, A. and Chandra, S. (2024). <em>PhiUSIIL: Phishing URL (Website) Dataset</em>. UCI Machine Learning Repository. <a href="https://doi.org/10.1016/j.cose.2023.103545" rel="noreferrer noopener" target="_blank">doi:10.1016/j.cose.2023.103545</a>. Source: <a href="https://archive.ics.uci.edu/dataset/967/phiusiil+phishing+url+dataset" rel="noreferrer noopener" target="_blank">archive.ics.uci.edu/dataset/967</a>.</p>
            <p>Source label convention is <strong>1 = legitimate, 0 = phishing</strong>. This project maps to <strong>1 = phishing</strong> in one tested function, and aborts an evaluation if test ROC-AUC &lt; 0.5 (inversion guard).</p>
            <p>Only the <code className="font-mono">URL</code> column and label are used. The 53 other columns are page-derived features that cannot be computed from a URL string at inference time and are ignored. Exact duplicate URLs (425) were removed before splitting.</p>
            {status?.dataset.phiusiil_present
              ? <Alert tone="success">Server copy: {status.dataset.rows?.toLocaleString()} rows · SHA-256 {shortHash(status.dataset.sha256, 16)} · downloaded {status.dataset.downloaded_utc}.</Alert>
              : <Alert tone="info">The server does not report a local dataset copy (connect the API for live dataset status). See docs/DATA_PROVENANCE.md for the recorded hash and download date.</Alert>}
          </Section>

          <Section id="model" title="Model & scoring">
            <ul>
              <li><strong>URL classifier:</strong> character 3–5-gram TF-IDF + logistic regression, trained on the URL string only, so the live tool can score any pasted URL with the same preprocessing used in training.</li>
              <li><strong>Method A (ML only):</strong> flag if model score ≥ t_hi.</li>
              <li><strong>Method B (naive fusion):</strong> add a bonus on any match; subtract a penalty on anything else, so “no match” and “unknown” are treated as benign evidence.</li>
              <li><strong>Method C (reliability-aware):</strong> explicit per-state rules. Fresh match is trusted only if the model does not contradict it; stale or synthetic matches get little or no weight; NO_MATCH and UNKNOWN contribute nothing; a conflict or uncertain band goes to <em>Needs review</em>.</li>
              <li><strong>Thresholds</strong> (t_hi, t_low, naive threshold) are tuned on the validation split only. The test split is never used for tuning.</li>
              <li><strong>Scores:</strong> only the raw model output is a model probability, and it is <em>not calibrated</em> on real traffic. The overall “risk score” is a heuristic ranking value, never a calibrated probability.</li>
            </ul>
          </Section>

          <Section id="ti" title="Threat intelligence: states & sources">
            <div className="flex flex-wrap gap-2"><Badge tone="high">MATCH</Badge><Badge tone="neutral">NO_MATCH</Badge><Badge tone="dashed">UNKNOWN</Badge></div>
            <ul>
              <li><strong>MATCH</strong> — the URL or its host is an exact entry in the loaded snapshot (fresh or stale by observation age and expiry).</li>
              <li><strong>NO_MATCH</strong> — the snapshot was consulted and has no exact entry. <strong>This never implies the URL is safe</strong>; feeds are incomplete.</li>
              <li><strong>UNKNOWN</strong> — no snapshot, or it was not consulted. Also not evidence of safety.</li>
            </ul>
            <p>The bundled snapshot is a <strong>hand-written demo</strong> on reserved <code className="font-mono">.example</code> names. No independent real threat-intelligence feed has been integrated yet; the loader (<code className="font-mono">TISnapshot.from_csv</code>) accepts one with source, timestamp and licence recorded.</p>
          </Section>

          <Section id="email" title="URL classifier vs email-body classifier">
            <p>The dataset contains URLs, not emails. The classifier therefore scores <strong>URLs extracted from</strong> an email; it has <strong>not been trained or validated on email text</strong>. Header checks (Reply-To mismatch, SPF/DKIM/DMARC results, link-text mismatch, urgency wording) are separate, transparent heuristics shown as such, and they are not validated either.</p>
          </Section>

          <Section id="exp" title="Experimental design: three evidence levels">
            <ul>
              <li><Badge tone="accent">A · Empirical</Badge> <strong>Classifier on PhiUSIIL.</strong> Stratified 60/20/20 holdout and a host-grouped holdout (no host in two partitions), three seeds, plus a preprocessing ablation that removes the scheme and “www.”. Bootstrap CIs, ROC, calibration, latency.</li>
              <li><Badge tone="neutral">B · Independent TI</Badge> <strong>Not yet done.</strong> No independent, licensed, dated feed has been integrated, so no claim about real-world threat intelligence is made.</li>
              <li><Badge tone="sim">C · Simulation</Badge> <strong>Controlled feed degradation:</strong> random coverage loss, synthetic false matches (unlabelled and labelled), stale entries, outages, and a shuffled negative control. The “oracle” feed is built from test labels and is an upper bound; the “proxy” feed uses training-split hosts.</li>
            </ul>
            <p>Every saved run records <code className="font-mono">is_synthetic</code>, dataset hash, timestamp, configuration, seeds, split protocol, preprocessing version and dependency versions. Previous results are archived, not overwritten.</p>
            <p>Mapping to course modules: <Badge tone="dashed">pending</Badge> the official module titles have not been supplied, so none are invented.</p>
          </Section>

          <Section id="repro" title="Reproduce"><div className="space-y-4">{COMMANDS.map((c) => <Cmd key={c.label} {...c} />)}</div></Section>

          <Section id="limits" title="Known limitations">
            <ul>
              <li><strong>Dataset artefacts:</strong> raw-URL accuracy is inflated by scheme/“www.” patterns; the stripped ablation is the more conservative estimate.</li>
              <li><strong>Single collection:</strong> one dataset, one time window; distribution shift and label noise are untested. Near-duplicate and sibling-subdomain leakage is only partly controlled.</li>
              <li><strong>Ceiling effect:</strong> where the URL model is already near-perfect, threat intelligence has little room to help; comparisons between A, B and C are then dominated by how each method handles <em>noise</em>.</li>
              <li><strong>Simulation ≠ reality:</strong> the degradation models are assumptions, and the labelled-noise condition is an upper bound.</li>
              <li><strong>Statistics:</strong> three seeds give only rough variability; bootstrap CIs cover test-set sampling, not split variance.</li>
              <li><strong>Exact matching only</strong>, no wildcard or redirect-aware matching. Calibration was evaluated but not applied to live scores.</li>
              <li><strong>Hosting:</strong> free hosts may erase saved incidents on restart. Not an email gateway.</li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
