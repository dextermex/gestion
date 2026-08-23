"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { Icon } from "./icons";

/* ---------------------------------- Button --------------------------------- */

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 disabled:pointer-events-none motion-reduce:active:scale-100",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" &&
          "bg-white text-ink border border-sand-200 hover:border-brand-300 hover:text-brand-700 shadow-sm",
        variant === "ghost" && "text-ink-soft hover:bg-sand-100 hover:text-ink",
        variant === "danger" && "bg-accent-600 text-white hover:bg-accent-700",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner size={16} className="text-current" />}
      {children}
    </button>
  );
}

/* ---------------------------------- Inputs --------------------------------- */

const fieldClass =
  "w-full rounded-xl border border-sand-200 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-sand-50";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input className={clsx(fieldClass, className)} {...rest} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={clsx(fieldClass, "min-h-24", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(fieldClass, "appearance-none pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft/70">{hint}</span>}
    </label>
  );
}

/* ---------------------------------- Layout --------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-2xl border border-sand-200 bg-white shadow-sm", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        className ?? "bg-sand-100 text-ink-soft"
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

/* ----------------------------- Async state UI ------------------------------ */

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={clsx("animate-spin", className ?? "text-brand-600")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-soft">
      <Spinner size={28} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-sand-100", className)} />;
}

export function EmptyState({
  icon = "search",
  title,
  body,
  action,
}: {
  icon?: React.ComponentProps<typeof Icon>["name"];
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-sand-200 bg-sand-50/50 px-6 py-14 text-center">
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      {body && <p className="max-w-sm text-sm text-ink-soft">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body,
  retry,
}: {
  title?: string;
  body?: string;
  retry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-accent-200 bg-accent-50 px-6 py-12 text-center"
    >
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-white text-accent-600 shadow-sm">
        <Icon name="alert" size={22} />
      </span>
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      {body && <p className="max-w-md text-sm text-ink-soft">{body}</p>}
      {retry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700">
      {children}
    </p>
  );
}

/* ----------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            className={clsx(
              "max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl",
              wide ? "sm:max-w-2xl" : "sm:max-w-md"
            )}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-sand-100"
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------- Stats ---------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentProps<typeof Icon>["name"];
}) {
  return (
    <Card className="group p-4 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-brand-100 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-ink-soft/80">{hint}</p>}
        </div>
        {icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110 motion-reduce:group-hover:scale-100">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------- Formatting ------------------------------ */

export function formatEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-LU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(iso);
}
