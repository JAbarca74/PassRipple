import { BadgeCheck, CalendarDays, IdCard, MapPin, Share2, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import { APP_URL, type EventStatus, events, type PublicEvent } from "../data.ts";
import { cn } from "../lib/cn.ts";
import { formatColones, formatEventDate } from "../lib/format.ts";
import { SiteLayout } from "../ui/layout.tsx";

const statusLabels: Record<Exclude<EventStatus, "on-sale">, string> = {
  "sold-out": "Agotado",
  cancelled: "Evento cancelado",
};

/** Public event page. `status` overrides the event's own status to preview the variants. */
export function EventPage({
  event,
  status = event.status,
}: {
  event: PublicEvent;
  status?: EventStatus;
}) {
  const onSale = status === "on-sale";
  const shareText = encodeURIComponent(`${event.name}: entradas en PassRipple`);
  return (
    <SiteLayout>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-8 md:pb-12">
        <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="flex aspect-[1.8/1] items-end rounded-2xl bg-gradient-to-br from-brand to-ink p-6 text-white">
              <div>
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                  {event.adultsOnly ? "SOLO MAYORES DE 18" : "TODO PÚBLICO"}
                </span>
                <h1 className="mt-3 text-3xl font-black sm:text-4xl">{event.name}</h1>
              </div>
            </div>

            {status !== "on-sale" && (
              <p
                role="status"
                className={cn(
                  "mt-4 rounded-xl p-4 font-bold",
                  status === "cancelled" ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-800",
                )}
              >
                {statusLabels[status]}
                {status === "cancelled" && (
                  <span className="mt-1 block text-sm font-normal">
                    Si compró, le avisamos por correo o mensaje cómo recibir su devolución.
                  </span>
                )}
              </p>
            )}

            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <Info icon={CalendarDays} label="Cuándo" value={formatEventDate(event.startsAt)} />
              <Info icon={MapPin} label="Dónde" value={`${event.venue} · ${event.canton}`} />
              <Info
                icon={BadgeCheck}
                label="Organiza"
                value={
                  <a className="underline" href={`/organizadores/${event.organizer.slug}`}>
                    {event.organizer.name}
                    {event.organizer.verified && " · verificado"}
                  </a>
                }
              />
              <Info icon={Users} label="Aforo autorizado" value={`${event.capacity} personas`} />
            </dl>

            {event.adultsOnly && (
              <div className="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <IdCard size={20} className="shrink-0 text-verify" aria-hidden />
                <p>
                  <b>Evento para mayores de 18.</b> Cada entrada lleva el nombre de quien asiste, y
                  en la puerta se pide la cédula o el documento de identidad.
                </p>
              </div>
            )}

            <div className="mt-6 flex gap-3 rounded-xl border border-brand/20 bg-brand-soft p-4 text-sm">
              <ShieldCheck size={20} className="shrink-0 text-brand" aria-hidden />
              <p>
                <b>Su entrada es segura.</b> El código cambia cada 30 segundos y se usa una sola
                vez. Una copia o una captura no sirven para entrar.
              </p>
            </div>
          </div>

          <aside className="h-fit rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="font-bold">Entradas</h2>
            <ul>
              {event.ticketTypes.map((type) => (
                <li
                  key={type.name}
                  className="flex items-center justify-between border-b border-slate-100 py-4"
                >
                  <span>
                    <b>{type.name}</b>
                    <span className="block text-sm text-slate-600">
                      {formatColones(type.price)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      type.availability === "Quedan pocas" ? "text-amber-700" : "text-slate-600",
                    )}
                  >
                    {status === "on-sale" ? type.availability : statusLabels[status]}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-600">
              El cargo por servicio se muestra desglosado antes de pagar.
            </p>
            {onSale && (
              <a
                href={`${APP_URL}/comprar`}
                className="mt-4 hidden min-h-12 w-full items-center justify-center rounded-xl bg-ink font-bold text-white md:flex"
              >
                Comprar
              </a>
            )}
            <a
              href={`https://wa.me/?text=${shareText}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line font-bold"
            >
              <Share2 size={17} aria-hidden /> Compartir por WhatsApp
            </a>
          </aside>
        </div>
      </main>

      {onSale && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 p-4 backdrop-blur md:hidden">
          <a
            href={`${APP_URL}/comprar`}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-ink font-bold text-white"
          >
            Comprar
          </a>
        </div>
      )}
    </SiteLayout>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600">
        <Icon size={14} aria-hidden /> {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

export function OrganizerPage() {
  const first = events[0];
  if (!first) return null;
  const { organizer } = first;
  const upcoming = events.filter((event) => event.organizer.slug === organizer.slug);
  return (
    <SiteLayout>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
        <p className="flex items-center gap-2 text-sm font-bold text-brand">
          <BadgeCheck size={16} aria-hidden /> Organizador verificado
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">{organizer.name}</h1>
        <h2 className="mt-10 text-xl font-black">Próximos eventos</h2>
        <ul className="mt-4 space-y-3">
          {upcoming.map((event) => (
            <li key={event.slug}>
              <a
                href={`/eventos/${event.slug}`}
                className="flex min-h-16 items-center justify-between rounded-2xl border border-line bg-white p-5 hover:border-brand"
              >
                <span>
                  <b>{event.name}</b>
                  <span className="block text-sm text-slate-600">
                    {formatEventDate(event.startsAt)}
                  </span>
                </span>
                <span className="text-sm font-bold text-brand">Ver evento</span>
              </a>
            </li>
          ))}
        </ul>
        <h2 className="mt-10 text-xl font-black">Eventos pasados</h2>
        <p className="mt-4 rounded-2xl border border-line bg-white p-5 text-sm text-slate-600">
          Festival Deportivo · 2025
        </p>
      </main>
    </SiteLayout>
  );
}
