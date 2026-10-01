import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { CookieBanner, openCookiePreferences } from "./CookieBanner.tsx";
import { Logo } from "./Logo.tsx";

export function SiteLayout({ dark = false, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-h-dvh flex-col", dark ? "bg-ink text-white" : "bg-canvas")}>
      <header className={cn("border-b", dark ? "border-slate-800" : "border-line bg-white")}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <a href="/" aria-label="PassRipple, inicio">
            <Logo onDark={dark} />
          </a>
          <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-4">
            <a href="/#eventos" className="flex min-h-12 items-center px-2">
              Eventos
            </a>
            <a href="/#organizadores" className="flex min-h-12 items-center px-2">
              Para organizadores
            </a>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <Footer />
      <CookieBanner />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-ink text-sm text-slate-300">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Logo onDark className="h-8" />
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <a href="/privacidad" className="hover:text-white">
            Privacidad
          </a>
          <a href="/terminos" className="hover:text-white">
            Términos
          </a>
          <a href="/eliminar-datos" className="hover:text-white">
            Eliminar mis datos
          </a>
          <button type="button" onClick={openCookiePreferences} className="hover:text-white">
            Preferencias de cookies
          </button>
        </nav>
      </div>
    </footer>
  );
}
