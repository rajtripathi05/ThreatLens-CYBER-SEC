import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Button
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-[0_0_0_1px_rgba(45,212,191,0.4),0_8px_24px_-10px_rgba(45,212,191,0.6)] hover:bg-accent-dim active:translate-y-px",
        secondary: "border border-line bg-raised/80 text-ink hover:border-accent/40 hover:bg-raised",
        ghost: "text-muted hover:bg-raised hover:text-ink",
        danger: "border border-sev-high/40 bg-sev-high/10 text-sev-high hover:bg-sev-high/20",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-10 px-5", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...p}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";

// ---------------------------------------------------------------- Badge
const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide", {
  variants: {
    tone: {
      neutral: "border-line bg-raised text-muted",
      high: "border-sev-high/40 bg-sev-high/10 text-sev-high",
      medium: "border-sev-medium/40 bg-sev-medium/10 text-sev-medium",
      low: "border-sev-low/40 bg-sev-low/10 text-sev-low",
      accent: "border-accent/40 bg-accent/10 text-accent",
      sim: "border-sim/40 bg-sim/10 text-sim",
      demo: "border-demo/50 bg-demo/10 text-demo",
      dashed: "border-dashed border-faint bg-transparent text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ tone, className, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

// ---------------------------------------------------------------- Card
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...p} />;
}
export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5", className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[0.95rem] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Alert
const alertTone = {
  info: { cls: "border-sev-low/30 bg-sev-low/5 text-sev-low", icon: Info },
  warn: { cls: "border-demo/40 bg-demo/5 text-demo", icon: AlertTriangle },
  error: { cls: "border-sev-high/40 bg-sev-high/5 text-sev-high", icon: XCircle },
  success: { cls: "border-accent/40 bg-accent/5 text-accent", icon: CheckCircle2 },
  sim: { cls: "border-sim/40 bg-sim/5 text-sim", icon: Info },
} as const;
export function Alert({ tone = "info", title, children, className, action }: { tone?: keyof typeof alertTone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const { cls, icon: Icon } = alertTone[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border px-3.5 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("text-ink/80", title && "mt-0.5")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Spinner / Empty / Skeleton
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-bg/30 px-6 py-10 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Metric
export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "accent" }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-bg/60 px-3.5 py-3">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-0.5", tone === "accent" ? "bg-accent" : "bg-line")} />
      <p className="label">{label}</p>
      <p className={cn("numeral mt-1 text-2xl", tone === "accent" ? "text-accent" : "text-ink")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Tooltip
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink shadow-lg">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---------------------------------------------------------------- Dialog
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-xl", wide ? "max-w-2xl" : "max-w-md")}>
          <div className="flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close dialog" className="rounded p-1 text-muted hover:bg-raised hover:text-ink"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>
          {description && <DialogPrimitive.Description className="mt-1.5 text-sm text-muted">{description}</DialogPrimitive.Description>}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------- Page header
export function PageHeader({ title, description, actions, eyebrow, kicker }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; kicker?: string }) {
  return (
    <header className="fade-in mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-5">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2"><span className="eyebrow">{kicker ?? "Workbench"}</span>{eyebrow}</div>
        <h1 className="text-2xl font-semibold sm:text-[1.9rem] sm:leading-tight">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------- Segmented control (radio group)
export function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-md border border-line bg-bg p-0.5 [&[aria-label='Data mode']]:flex-nowrap">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} disabled={o.disabled} onClick={() => onChange(o.value)}
          className={cn("whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
            value === o.value ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
