import { BookOpenText, ChevronsLeft, ChevronsRight, FlaskConical, History, LayoutDashboard, Menu, PlayCircle, ScanSearch, ScrollText, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button, Tip, TooltipProvider } from "@/components/ui/primitives";
import { StatusPill } from "@/components/StatusPill";
import { ModeBanner } from "@/components/ModeBanner";
import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import { applyUpdate, usePwa } from "@/lib/pwa";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; code: string };
const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true, code: "01" },
  { to: "/analyzer", label: "Analyzer", icon: ScanSearch, code: "02" },
  { to: "/evidence", label: "Evidence Explorer", icon: ScrollText, code: "03" },
  { to: "/research", label: "Research Lab", icon: FlaskConical, code: "04" },
  { to: "/incidents", label: "Incident History", icon: History, code: "05" },
  { to: "/methodology", label: "Methodology & Data", icon: BookOpenText, code: "06" },
];
const DEMO_NAV: NavItem = { to: "/demo", label: "Guided Demo", icon: PlayCircle, code: "▶" };

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0C1424" stroke="#1E2C45" />
      <path d="M4 20h5l2-6 3 10 3-14 2 10h9" fill="none" stroke="#2DD4BF" strokeOpacity=".35" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="15" cy="15" r="6.2" fill="none" stroke="#2DD4BF" strokeWidth="2.2" />
      <path d="M19.6 19.6 25 25" stroke="#2DD4BF" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="15" cy="15" r="1.8" fill="#E8EEF8" />
    </svg>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1">
      <Mark className="h-8 w-8 shrink-0" />
      {!compact && (
        <div className="min-w-0 leading-none">
          <p className="font-display text-[0.95rem] font-bold tracking-[0.08em]">THREATLENS <span className="text-accent">AI</span></p>
          <p className="mt-1 truncate font-mono text-[0.58rem] uppercase tracking-[0.18em] text-faint">Security research workbench</p>
        </div>
      )}
    </div>
  );
}

function NavRow({ item, collapsed, onNavigate, featured }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void; featured?: boolean }) {
  const { to, label, icon: Icon, end, code } = item;
  const link = (
    <NavLink to={to} end={end} onClick={onNavigate} aria-label={collapsed ? label : undefined}
      className={({ isActive }) => cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
        collapsed && "justify-center px-0",
        featured && !isActive && "border border-accent/30 bg-accent/[0.06] text-ink hover:bg-accent/10",
        isActive ? "bg-raised font-medium text-ink shadow-[inset_2px_0_0_#2DD4BF]" : !featured && "text-muted hover:bg-raised/60 hover:text-ink")}>
      {({ isActive }) => (<>
        <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive || featured ? "text-accent" : "text-faint group-hover:text-muted")} aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
        {!collapsed && <span className={cn("font-mono text-[0.6rem] tabular-nums", isActive ? "text-accent" : "text-faint/70")}>{code}</span>}
      </>)}
    </NavLink>
  );
  return collapsed ? <Tip content={label}>{link}</Tip> : link;
}

function Nav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="mt-7 flex flex-col gap-0.5">
      {!collapsed && <p className="mb-2 px-3 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-faint">Workbench</p>}
      {NAV.map((n) => <NavRow key={n.to} item={n} collapsed={collapsed} onNavigate={onNavigate} />)}
      {!collapsed && <p className="mb-2 mt-6 px-3 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-faint">Presentation</p>}
      {collapsed && <div className="my-3 h-px bg-line" />}
      <NavRow item={DEMO_NAV} collapsed={collapsed} onNavigate={onNavigate} featured />
    </nav>
  );
}

const CRUMB: Record<string, string> = { "": "Overview", analyzer: "Analyzer", evidence: "Evidence Explorer", research: "Research Lab", incidents: "Incident History", methodology: "Methodology & Data", demo: "Guided Demo" };
const readCollapsed = () => { try { return localStorage.getItem("tl.sidebar") === "1"; } catch { return false; } };

export function Layout() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const loc = useLocation();
  const { mode } = useApp();
  const pwa = usePwa();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem("tl.sidebar", collapsed ? "1" : "0"); } catch { /* storage unavailable */ } }, [collapsed]);
  const section = CRUMB[loc.pathname.split("/")[1] ?? ""] ?? "—";

  return (
    <TooltipProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">Skip to content</a>
      <div className="flex min-h-screen">
        <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface/95 py-5 backdrop-blur transition-[width] duration-200 lg:flex", collapsed ? "w-[4.25rem] px-2" : "w-64 px-3")}>
          <Brand compact={collapsed} />
          <Nav collapsed={collapsed} />
          <div className="mt-auto space-y-3">
            {!collapsed && (
              <div className="rounded-lg border border-line bg-bg/50 p-3">
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-faint">Scope</p>
                <p className="mt-1 text-2xs leading-relaxed text-muted">Research prototype. Outputs are triage hints for human review, not verdicts. URLs are parsed as text and never fetched.</p>
              </div>
            )}
            <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}
              className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-faint transition-colors hover:bg-raised hover:text-ink", collapsed && "justify-center px-0")}>
              {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <><ChevronsLeft className="h-4 w-4" aria-hidden />Collapse</>}
            </button>
          </div>
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button className="fade-in absolute inset-0 bg-black/70" aria-label="Close navigation" onClick={() => setOpen(false)} />
            <aside className="fade-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface px-3 py-5">
              <div className="flex items-center justify-between"><Brand />
                <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button></div>
              <Nav onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}

        <div className={cn("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[4.25rem]" : "lg:pl-64")}>
          <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></Button>
            <div className="lg:hidden"><Brand compact /></div>
            <p className="hidden min-w-0 items-center gap-2 font-mono text-2xs uppercase tracking-[0.14em] text-faint md:flex">
              <span>ThreatLens</span><span aria-hidden>/</span><span className="truncate text-ink">{section}</span>
            </p>
            <div className="ml-auto shrink-0"><StatusPill /></div>
          </div>
          {mode === "demo" && <ModeBanner />}
          <ConnectivityBanner />
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"><Outlet /></main>
          <footer className="border-t border-line px-4 py-4 sm:px-6 lg:px-8">
            <p className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-faint">
              <span>ThreatLens AI · research prototype{pwa.offlineReady ? " · offline-ready" : ""}{pwa.updateAvailable && <> · <button className="underline" onClick={applyUpdate}>update available: reload</button></>}</span><span>Dataset: PhiUSIIL (Prasad &amp; Chandra, CC BY 4.0)</span>
            </p>
          </footer>
        </div>
      </div>
    </TooltipProvider>
  );
}
