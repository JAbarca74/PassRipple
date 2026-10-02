import { ArrowRight, BarChart3, QrCode, ShieldCheck, Smartphone, WalletCards } from "lucide-react";
import { events, type PublicEvent } from "../data.ts";
import { formatEventDate } from "../lib/format.ts";
import { SiteLayout } from "../ui/layout.tsx";

export function Home() {
  return (
    <SiteLayout dark>
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <section className="grid items-center gap-12 py-16 md:grid-cols-[1.05fr_0.95fr] md:py-24">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-wave/30 bg-wave/10 px-3 py-1.5 text-xs font-semibold text-wave">
              <ShieldCheck size={15} aria-hidden /> Su entrada, siempre con usted
            </p>
            <h1 className="max-w-2xl text-5xl font-black leading-none tracking-tight sm:text-7xl">
              Entradas que no se pueden copiar.
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-8 text-slate-300">
              El papel no es la entrada.{" "}
              <strong className="text-white">El registro es la entrada.</strong> Compre, guarde y
              entre desde su teléfono.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href="#eventos"
                className="flex min-h-12 items-center gap-2 rounded-xl bg-wave px-5 font-bold text-ink"
              >
                Ver próximos eventos <ArrowRight size={17} aria-hidden />
              </a>
              <a
                href="#organizadores"
                className="flex min-h-12 items-center rounded-xl border border-slate-600 px-5 font-bold"
              >
                Soy organizador
              </a>
            </div>
          </div>
          <TicketPreview />
        </section>

        <section id="eventos" className="border-t border-slate-800 py-14">
          <p className="text-sm font-bold text-wave">PRÓXIMOS EVENTOS</p>
          <h2 className="mt-2 text-3xl font-black">Viva la experiencia.</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <EventCard key={event.slug} event={event} />
            ))}
          </div>
        </section>

        <section aria-labelledby="como" className="py-14">
          <h2 id="como" className="text-3xl font-black">
            Cómo funciona
          </h2>
          <ol className="mt-7 grid gap-5 sm:grid-cols-3">
            <Step
              n="01"
              title="Elija su evento"
              text="Escoja sus entradas y la cantidad en la misma pantalla."
            />
            <Step
              n="02"
              title="Pague con SINPE"
              text="Le mostramos el monto exacto. El banco confirma su pago."
            />
            <Step
              n="03"
              title="Entre con su teléfono"
              text="Su código cambia cada 30 segundos y se usa una sola vez."
            />
          </ol>
        </section>

        <section id="organizadores" className="mb-16 rounded-3xl bg-white p-8 text-ink sm:p-12">
          <p className="text-sm font-bold text-brand">PARA ORGANIZADORES</p>
          <h2 className="mt-2 max-w-xl text-3xl font-black">
            Sepa en todo momento cuánto vendió, quién entró y cuánto dinero es suyo.
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <Feature
              icon={BarChart3}
              title="Ventas en vivo"
              text="Cada cobro aparece en su panel apenas el banco lo confirma."
            />
            <Feature
              icon={Smartphone}
              title="Puertas sin señal"
              text="Los validadores funcionan toda la noche sin internet."
            />
            <Feature
              icon={WalletCards}
              title="Liquidación verificable"
              text="Cada colón queda en un libro que usted puede revisar."
            />
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}

function TicketPreview() {
  const event = events[0];
  if (!event) return null;
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden>
      <div className="absolute -inset-4 rounded-[2rem] bg-brand/30 blur-2xl" />
      <div className="relative rounded-[2rem] border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="rounded-2xl bg-white p-5 text-ink">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>SU ENTRADA</span>
            <span className="text-green-700">● ACTIVA</span>
          </div>
          <div className="mt-8 grid place-items-center rounded-xl bg-ink p-7">
            <QrCode className="size-36 text-white" strokeWidth={1.2} />
          </div>
          <p className="mt-5 text-xs text-slate-600">{event.name.toUpperCase()}</p>
          <p className="mt-1 text-xl font-black">Entrada General</p>
          <p className="mt-3 text-sm text-slate-600">{formatEventDate(event.startsAt)}</p>
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: PublicEvent }) {
  return (
    <a
      href={`/eventos/${event.slug}`}
      className="group block rounded-2xl border border-slate-700 bg-slate-900 p-5 transition-colors hover:border-wave"
    >
      <div className="mb-6 flex aspect-[2.2/1] items-end rounded-xl bg-gradient-to-br from-brand via-indigo-800 to-slate-800 p-4">
        <span className="rounded-full bg-ink/70 px-3 py-1 text-xs font-bold">
          {event.adultsOnly ? "18+" : "Todo público"}
        </span>
      </div>
      <h3 className="text-xl font-bold group-hover:text-wave">{event.name}</h3>
      <p className="mt-2 text-sm text-slate-300">{formatEventDate(event.startsAt)}</p>
      <p className="mt-1 text-sm text-slate-300">
        {event.venue} · {event.canton}
      </p>
    </a>
  );
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="rounded-2xl border border-slate-800 p-5">
      <span className="text-sm font-black text-wave">{n}</span>
      <h3 className="mt-6 text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
    </li>
  );
}

function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof BarChart3;
  title: string;
  text: string;
}) {
  return (
    <div>
      <Icon className="text-brand" aria-hidden />
      <h3 className="mt-3 font-bold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}
