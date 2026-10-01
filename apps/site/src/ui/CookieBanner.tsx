// Cookie consent for the public site, the only origin with analytics.
// Non-blocking bar, three equal buttons, everything optional off by default.
import { useEffect, useState } from "react";

type Consent = { analytics: boolean; advertising: boolean };

const STORAGE_KEY = "passripple.cookie-consent";
const OPEN_EVENT = "passripple:cookie-preferences";

function readConsent(): Consent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Consent) : null;
  } catch {
    return null;
  }
}

function saveConsent(consent: Consent): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // Storage can be blocked; the banner simply shows again on the next visit.
  }
}

export function openCookiePreferences(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CookieBanner() {
  const [visible, setVisible] = useState(() => readConsent() === null);
  const [configuring, setConfiguring] = useState(false);
  const [choice, setChoice] = useState<Consent>(
    () => readConsent() ?? { analytics: false, advertising: false },
  );

  useEffect(() => {
    const open = () => {
      setVisible(true);
      setConfiguring(true);
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  if (!visible) return null;

  const decide = (consent: Consent) => {
    saveConsent(consent);
    setChoice(consent);
    setVisible(false);
    setConfiguring(false);
  };

  const buttonClass =
    "min-h-12 flex-1 rounded-xl border border-slate-600 px-2 text-sm font-bold text-white hover:bg-slate-800";

  return (
    <section
      aria-label="Preferencias de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-700 bg-ink p-3 text-white shadow-2xl sm:p-4"
    >
      <div className="mx-auto max-w-4xl">
        <p className="text-xs text-slate-200 sm:text-sm">
          Usamos cookies necesarias para que el sitio funcione. Con su permiso, también medimos
          visitas y anuncios. En la compra y en su billetera no hay cookies de terceros.
        </p>
        {configuring && (
          <div className="mt-4 space-y-2 text-sm">
            <label className="flex min-h-12 items-center justify-between rounded-xl bg-slate-800 px-4">
              Necesarias
              <input type="checkbox" checked disabled className="size-5" />
            </label>
            <label className="flex min-h-12 items-center justify-between rounded-xl bg-slate-800 px-4">
              Analítica
              <input
                type="checkbox"
                className="size-5 accent-wave"
                checked={choice.analytics}
                onChange={(event) => setChoice({ ...choice, analytics: event.target.checked })}
              />
            </label>
            <label className="flex min-h-12 items-center justify-between rounded-xl bg-slate-800 px-4">
              Publicidad
              <input
                type="checkbox"
                className="size-5 accent-wave"
                checked={choice.advertising}
                onChange={(event) => setChoice({ ...choice, advertising: event.target.checked })}
              />
            </label>
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => decide({ analytics: true, advertising: true })}
          >
            Aceptar
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => decide({ analytics: false, advertising: false })}
          >
            Rechazar
          </button>
          {configuring ? (
            <button type="button" className={buttonClass} onClick={() => decide(choice)}>
              Guardar selección
            </button>
          ) : (
            <button type="button" className={buttonClass} onClick={() => setConfiguring(true)}>
              Configurar
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
