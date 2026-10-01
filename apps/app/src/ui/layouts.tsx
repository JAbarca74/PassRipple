import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Link, usePathname } from "../router.tsx";
import { Logo } from "./Logo.tsx";

/** Mobile-first layout for the buyer: checkout and wallet. */
export function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link to="/entradas" aria-label="PassRipple, mis entradas">
            <Logo />
          </Link>
          <Link to="/entradas" className="flex min-h-12 items-center text-sm font-bold">
            Mis entradas
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">{children}</main>
    </div>
  );
}

export type PanelNavItem = { to: string; label: string; icon: LucideIcon };

/** Desktop-first layout for organizers, administration and the municipality. */
export function PanelLayout({
  area,
  nav,
  children,
}: {
  area: string;
  nav: readonly PanelNavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white p-5 lg:block">
        <Link to="/" aria-label="PassRipple, inicio">
          <Logo />
        </Link>
        <p className="mt-8 px-3 text-xs font-black uppercase tracking-wider text-slate-500">
          {area}
        </p>
        <nav className="mt-2 space-y-1">
          {nav.map((item) => (
            <PanelLink key={item.to} item={item} active={pathname === item.to} />
          ))}
        </nav>
      </aside>
      <header className="sticky top-0 z-10 border-b border-line bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo />
          <span className="text-sm font-bold text-slate-600">{area}</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {nav.map((item) => (
            <PanelLink key={item.to} item={item} active={pathname === item.to} />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</main>
    </div>
  );
}

function PanelLink({ item, active }: { item: PanelNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap",
        active ? "bg-brand-soft font-bold text-brand" : "text-slate-700 hover:bg-slate-50",
      )}
    >
      <Icon size={17} aria-hidden />
      {item.label}
    </Link>
  );
}
