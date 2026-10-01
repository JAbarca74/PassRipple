import { Download, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { SiteLayout } from "../ui/layout.tsx";

export type LegalDocument = {
  title: string;
  version: string;
  effectiveDate: string;
  sections: readonly { id: string; title: string }[];
};

const PENDING_TEXT = "Texto pendiente de redacción y revisión legal.";

export const privacyPolicy: LegalDocument = {
  title: "Política de privacidad",
  version: "Borrador",
  effectiveDate: "Pendiente",
  sections: [
    { id: "responsable", title: "Quién es responsable de sus datos" },
    { id: "datos", title: "Qué datos guardamos y para qué" },
    { id: "conservacion", title: "Cuánto tiempo los guardamos" },
    { id: "derechos", title: "Sus derechos y cómo ejercerlos" },
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
              <p className="mt-3 leading-7 text-slate-700">{PENDING_TEXT}</p>
            </section>
          ))}
        </article>
      </main>
    </SiteLayout>
  );
}

/** Data deletion without installing anything: contact → code → confirmation. */
export function DeleteDataPage() {
  const [step, setStep] = useState(0);
  const next = (event: FormEvent) => {
    event.preventDefault();
    setStep(step + 1);
  };
  const inputClass = "mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4";
  return (
    <SiteLayout>
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-3xl font-black tracking-tight">Eliminar mis datos</h1>
        <p className="mt-2 text-slate-600">
          Use el correo o el teléfono con que compró. Le enviamos un código para confirmar que es
          usted.
        </p>
        <div className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-sm">
          {step === 0 && (
            <form onSubmit={next}>
              <label htmlFor="contact" className="block text-sm font-bold">
                Correo o teléfono
              </label>
              <input id="contact" required autoComplete="email" className={inputClass} />
              <button
                type="submit"
                className="mt-4 min-h-12 w-full rounded-xl bg-ink font-bold text-white"
              >
                Enviarme un código
              </button>
            </form>
          )}
          {step === 1 && (
            <form onSubmit={next}>
              <label htmlFor="code" className="block text-sm font-bold">
                Código de 6 dígitos
              </label>
              <input
                id="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                className={inputClass}
              />
              <p className="mt-2 text-xs text-slate-600">Vence en 10 minutos.</p>
              <button
                type="submit"
                className="mt-4 min-h-12 w-full rounded-xl bg-red-700 font-bold text-white"
              >
                Eliminar mis datos
              </button>
            </form>
          )}
          {step === 2 && (
            <div className="text-center">
              <ShieldCheck size={40} className="mx-auto text-valid" aria-hidden />
              <p className="mt-3 font-black">Recibimos su solicitud</p>
              <p className="mt-1 text-sm text-slate-600">
                Le confirmamos por el mismo medio cuando sus datos estén eliminados.
              </p>
            </div>
          )}
        </div>
      </main>
    </SiteLayout>
  );
}
