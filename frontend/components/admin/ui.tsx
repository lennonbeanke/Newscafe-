import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Plain, accessible building blocks for the owner screens (no motion, no custom cursor, no smooth-scroll tricks). */

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-onyx p-8 shadow-[0_30px_80px_-40px_var(--sheet-shadow)] sm:p-10">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-gold">News Cafe · Owner</p>
      <h1 className="mt-3 font-display text-4xl leading-tight text-bone">{title}</h1>
      {subtitle ? <p className="mt-3 text-sm leading-relaxed text-mist">{subtitle}</p> : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 border-t border-line pt-6 text-sm text-mist">{footer}</div> : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> { label: string; hint?: ReactNode; error?: string | null }

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-[0.18em] text-mist">{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined}
        className={cn(
          "w-full rounded-lg border border-line bg-ink px-4 py-3 text-base text-bone outline-none transition-colors placeholder:text-mist/60 focus:border-gold focus-visible:ring-2 focus-visible:ring-gold/40",
          error && "border-danger/70",
          className,
        )}
        {...rest}
      />
      {hint ? <p id={hintId} className="text-xs leading-relaxed text-mist">{hint}</p> : null}
      {error ? <p id={errId} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

type Variant = "primary" | "secondary" | "link";
export function AdminButton({ variant = "primary", className, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "w-full rounded-full bg-gold px-6 py-3.5 text-xs font-semibold uppercase tracking-[0.2em] text-ink hover:bg-gold-light disabled:opacity-60",
    secondary: "rounded-full border border-line px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-bone hover:border-gold disabled:opacity-60",
    link: "text-sm text-gold underline-offset-4 hover:underline disabled:opacity-60",
  };
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy ? true : undefined}
      className={cn("transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed", styles[variant], className)}
    >
      {children}
    </button>
  );
}

/** Errors are announced to screen readers (role="alert"); info is polite. */
export function Notice({ tone, children, requestId }: { tone: "error" | "info" | "warning"; children: ReactNode; requestId?: string }) {
  const tones = {
    error: "border-danger/50 bg-danger/10 text-danger",
    warning: "border-gold/50 bg-gold/10 text-gold-light",
    info: "border-line bg-smoke/40 text-bone",
  } as const;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm leading-relaxed", tones[tone])}>
      {children}
      {requestId ? <span className="mt-1 block text-xs opacity-70">Reference: {requestId}</span> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-mist">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-gold" />
      {label}
    </div>
  );
}

const fieldBase = "w-full rounded-lg border border-line bg-ink px-4 py-3 text-base text-bone outline-none transition-colors focus:border-gold focus-visible:ring-2 focus-visible:ring-gold/40";

export function SelectField({ label, hint, error, className, children, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id">) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-[0.18em] text-mist">{label}</label>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={cn(fieldBase, error && "border-danger/70", className)} {...rest}>{children}</select>
      {hint ? <p id={`${id}-hint`} className="text-xs leading-relaxed text-mist">{hint}</p> : null}
      {error ? <p id={`${id}-err`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function TextAreaField({ label, hint, error, className, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-[0.18em] text-mist">{label}</label>
      <textarea id={id} rows={3} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={cn(fieldBase, error && "border-danger/70", className)} {...rest} />
      {hint ? <p id={`${id}-hint`} className="text-xs leading-relaxed text-mist">{hint}</p> : null}
      {error ? <p id={`${id}-err`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
