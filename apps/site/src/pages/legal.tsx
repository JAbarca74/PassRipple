import { Download, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { SiteLayout } from "../ui/layout.tsx";

export type LegalSection = {
  id: string;
  title: string;
  /** Paragraphs already written. Sections without them show that the text is pending. */
  paragraphs?: readonly string[];
};

export type LegalDocument = {
  title: string;
  version: string;
  effectiveDate: string;
  sections: readonly LegalSection[];
};

const PENDING_TEXT = "Texto pendiente de redacción y revisión legal.";

// The parts about the gate app (design 14.5) must match the Data safety form in Google
// Play and, if it is ever published there, the App Store's privacy labels.
export const privacyPolicy: LegalDocument = {
  title: "Política de privacidad",
  version: "Borrador",
  effectiveDate: "Pendiente",
  sections: [
    { id: "responsable", title: "Quién es responsable de sus datos" },
    {
      id: "datos",
      title: "Qué datos guardamos y para qué",
      paragraphs: [
        "Personal de puerta (app PassRipple Puerta). Guardamos su correo electrónico, para enviarle el código con que entra a la app; el identificador del teléfono que unió a un evento, su sistema operativo y la versión de la app; y un registro de cada entrada que valida: qué entrada, cuándo y con qué teléfono. Ese registro permite saber cuántas personas entraron, detectar entradas usadas dos veces y cumplir con la fiscalización municipal.",
        "La app usa la cámara solo para leer los códigos QR de las entradas: no guarda ni envía imágenes. No usa su ubicación, sus contactos ni identificadores de publicidad, y no muestra anuncios.",
        "Para validar sin internet, el teléfono guarda cifrada la lista de entradas del evento: identificadores, estados y llaves públicas, sin secretos que permitan falsificar una entrada. Esa lista se borra del teléfono cuando el evento termina y todo está sincronizado, cuando el organizador revoca el acceso o cuando usted sale del evento.",
        PENDING_TEXT,
      ],
    },
    {
      id: "encargados",
      title: "Quién nos ayuda a tratarlos",
      paragraphs: [
        "Neon guarda la base de datos. Cloudflare hospeda la API y el sitio. Amazon Web Services (Amazon SES) envía los correos con los códigos de acceso. Esta lista se ampliará antes de usar cualquier otro proveedor.",
      ],
    },
    {
      id: "conservacion",
      title: "Cuánto tiempo los guardamos",
      paragraphs: [
        "Su correo se conserva mientras tenga cuenta y se borra al eliminarla. El registro de las entradas validadas se conserva sin su correo ni otro dato de contacto, porque las obligaciones municipales y tributarias lo exigen.",
        PENDING_TEXT,
      ],
    },
    {
      id: "derechos",
      title: "Sus derechos y cómo ejercerlos",
      paragraphs: [
        "Puede eliminar su cuenta de personal de puerta desde la app (Cuenta → Eliminar mi cuenta) o desde la página /eliminar-datos de este sitio, confirmando con un código que enviamos a su correo.",
        PENDING_TEXT,
      ],
    },
    { id: "cookies", title: "Cookies" },
    { id: "contacto", title: "Contacto" },
  ],
};

export const termsOfService: LegalDocument = {
  title: "Términos y condiciones",
  version: "Borrador",
  effectiveDate: "Pendiente",
  sections: [
    { id: "servicio", title: "El servicio" },
    { id: "compra", title: "La compra y el cargo por servicio" },
    { id: "entradas", title: "Uso de las entradas" },
    { id: "cancelaciones", title: "Cancelaciones y devoluciones" },
    { id: "contacto", title: "Contacto" },
  ],
};

/** Template for a legal document: version, effective date, index and sections. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <SiteLayout>
      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Índice" className="hidden lg:block">
          <ol className="sticky top-6 space-y-2 text-sm">
            {document.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-slate-600 hover:text-brand">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="max-w-prose">
          <h1 className="text-4xl font-black tracking-tight">{document.title}</h1>
          <p className="mt-3 text-sm text-slate-600">
            Versión: {document.version} · Vigente desde: {document.effectiveDate}
          </p>
          <button
            type="button"
            disabled
            className="mt-5 flex min-h-12 items-center gap-2 rounded-xl border border-line px-4 text-sm font-bold disabled:opacity-50"
          >
            <Download size={16} aria-hidden /> Descargar en PDF
          </button>
          {document.sections.map((section) => (
            <section key={section.id} id={section.id} className="mt-10 scroll-mt-6">
              <h2 className="text-xl font-black">{section.title}</h2>
              {(section.paragraphs ?? [PENDING_TEXT]).map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-7 text-slate-700">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </article>
      </main>
    </SiteLayout>
  );
}

/** The API, as configured for this build (VITE_API_URL). */
function apiUrl(path: string): string {
  return `${(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "")}${path}`;
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(apiUrl(path), {
    method: path === "/v1/account" ? "DELETE" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    return body.error?.code ?? "error";
  } catch {
    return "error";
  }
}

const ERROR_TEXT: Readonly<Record<string, string>> = {
  rate_limited: "Demasiados intentos. Espere unos minutos e intente de nuevo.",
  invalid_code: "El código es incorrecto, ya se usó o venció.",
  device_enrolled:
    "Uno de sus teléfonos sigue unido a un evento y podría tener validaciones sin subir. Abra la app y salga del evento primero.",
  invalid_request: "Revise el correo y el código.",
  network: "No hay conexión con PassRipple. Intente de nuevo.",
};

/**
 * Account deletion without installing anything (design 14.7): email → code → done. For
 * staff, organizers and inspectors, whose accounts sign in by email; buyers' data joins
 * this page when buying opens.
 */
export function DeleteDataPage() {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guarded(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(ERROR_TEXT.network ?? null);
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    void guarded(async () => {
      const response = await post("/v1/auth/sign-in", { email });
      if (!response.ok) {
        setError(ERROR_TEXT[await errorCode(response)] ?? "Algo salió mal. Intente de nuevo.");
        return;
      }
      setStep("code");
    });
  };

  const erase = (event: FormEvent) => {
    event.preventDefault();
    void guarded(async () => {
      const verified = await post("/v1/auth/verify", { email, code });
      if (!verified.ok) {
        setError(ERROR_TEXT[await errorCode(verified)] ?? "Algo salió mal. Intente de nuevo.");
        return;
      }
      const { token } = (await verified.json()) as { token: string };
      const deleted = await post("/v1/account", undefined, token);
      if (!deleted.ok) {
        setError(ERROR_TEXT[await errorCode(deleted)] ?? "Algo salió mal. Intente de nuevo.");
        return;
      }
      setStep("done");
    });
  };

  const inputClass = "mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4";
  return (
    <SiteLayout>
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-3xl font-black tracking-tight">Eliminar mi cuenta</h1>
        <p className="mt-2 text-slate-600">
          Para personal de puerta, organizadores y fiscalizadores. Use el correo con que entra a
          PassRipple: le enviamos un código para confirmar que es usted.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Se borran su correo y el acceso de sus teléfonos. Las validaciones y ventas se conservan
          sin datos suyos, por obligaciones municipales y tributarias. También puede hacerlo desde
          la app: Cuenta → Eliminar mi cuenta.
        </p>
        <div className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-sm">
          {step === "email" && (
            <form onSubmit={sendCode}>
              <label htmlFor="email" className="block text-sm font-bold">
                Correo
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value.trim().toLowerCase())}
                className={inputClass}
              />
              <button
                type="submit"
                disabled={busy}
                className="mt-4 min-h-12 w-full rounded-xl bg-ink font-bold text-white disabled:opacity-60"
              >
                Enviarme un código
              </button>
            </form>
          )}
          {step === "code" && (
            <form onSubmit={erase}>
              <label htmlFor="code" className="block text-sm font-bold">
                Código de 6 dígitos
              </label>
              <input
                id="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className={inputClass}
              />
              <p className="mt-2 text-xs text-slate-600">Vence en 10 minutos.</p>
              <button
                type="submit"
                disabled={busy}
                className="mt-4 min-h-12 w-full rounded-xl bg-red-700 font-bold text-white disabled:opacity-60"
              >
                Eliminar mi cuenta
              </button>
            </form>
          )}
          {step === "done" && (
            <div className="text-center">
              <ShieldCheck size={40} className="mx-auto text-valid" aria-hidden />
              <p className="mt-3 font-black">Su cuenta fue eliminada</p>
              <p className="mt-1 text-sm text-slate-600">
                Se borraron su correo y el acceso de sus teléfonos.
              </p>
            </div>
          )}
          {error !== null && (
            <p role="alert" className="mt-4 text-sm font-bold text-red-700">
              {error}
            </p>
          )}
        </div>
      </main>
    </SiteLayout>
  );
}
