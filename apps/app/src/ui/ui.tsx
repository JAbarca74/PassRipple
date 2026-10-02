// Small UI primitives shared by every screen of the app.
import type { LucideIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "../lib/cn.ts";
import { Link } from "../router.tsx";

const buttonVariants = {
  primary: "bg-ink text-white hover:bg-slate-800",
  brand: "bg-brand text-white hover:bg-brand/90",
  secondary: "border border-line bg-white text-ink hover:bg-slate-50",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "primary", className?: string): string {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    buttonVariants[variant],
    className,
  );
}

type ButtonProps = Omit<ComponentProps<"button">, "type"> & {
  variant?: ButtonVariant;
  submit?: boolean;
};

export function Button({ variant = "primary", submit = false, className, ...props }: ButtonProps) {
  return (
    <button
      type={submit ? "submit" : "button"}
      className={buttonClass(variant, className)}
      {...props}
    />
  );
}

type ButtonLinkProps = {
  to: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

export function ButtonLink({ to, variant = "primary", className, children }: ButtonLinkProps) {
  return (
    <Link to={to} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-white p-5 shadow-sm", className)}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-black">{children}</h2>
      {action}
    </div>
  );
}

const badgeTones = {
  valid: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  verify: "bg-amber-50 text-amber-800",
  info: "bg-blue-50 text-blue-700",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-slate-100 text-slate-700",
} as const;

export type Tone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-brand">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-slate-600">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Notice({
  icon: Icon,
  title,
  tone = "brand",
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone?: "brand" | "verify" | "valid";
  children?: ReactNode;
}) {
  const tones = {
    brand: "border-brand/20 bg-brand-soft text-ink [&_svg]:text-brand",
    verify: "border-amber-200 bg-amber-50 text-amber-950 [&_svg]:text-verify",
    valid: "border-green-200 bg-green-50 text-green-950 [&_svg]:text-valid",
  } as const;
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4 text-sm", tones[tone])}>
      <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <p className="font-bold">{title}</p>
        {children && <div className="mt-1 text-slate-700">{children}</div>}
      </div>
    </div>
  );
}

/** A label and a value on one line, used for summaries and breakdowns. */
export function Row({
  label,
  value,
  strong = false,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-2 text-sm",
        strong && "text-lg font-black",
      )}
    >
      <span className={strong ? undefined : "text-slate-600"}>{label}</span>
      <span className={strong ? undefined : "font-semibold"}>{value}</span>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      {note && <p className="mt-1 text-xs font-bold text-green-700">{note}</p>}
    </Card>
  );
}

type FieldProps = Omit<ComponentProps<"input">, "id"> & { label: string; hint?: string };

export function Field({ label, hint, className, ...props }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4"
        {...props}
      />
      {hint && <p className="mt-2 text-xs leading-5 text-slate-600">{hint}</p>}
    </div>
  );
}

export function Checkbox({
  label,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-3 text-sm text-slate-700">
      <input type="checkbox" className="size-5 accent-brand" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Horizontal step indicator: done steps, the current one and the ones still ahead. */
export function Steps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs font-bold">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5",
            index < current && "bg-green-50 text-green-700",
            index === current && "bg-ink text-white",
            index > current && "bg-slate-100 text-slate-600",
          )}
        >
          {index + 1}. {step}
        </li>
      ))}
    </ol>
  );
}
