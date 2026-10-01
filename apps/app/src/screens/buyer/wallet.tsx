import {
  ChevronRight,
  Download,
  Link2,
  QrCode,
  Share2,
  ShieldCheck,
  Smartphone,
  Trash2,
  WalletCards,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { demoEvent, demoOrder, demoTickets } from "../../demo.ts";
import { formatEventDate } from "../../lib/format.ts";
import { Link } from "../../router.tsx";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Field,
  Notice,
  Row,
  Steps,
} from "../../ui/ui.tsx";

const QR_WINDOW_SECONDS = 30;

export function Wallet() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-ink p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-300">Su billetera · Orden {demoOrder.code}</p>
            <h1 className="mt-1 text-xl font-black">{demoEvent.name}</h1>
            <p className="mt-1 text-sm text-slate-300">{formatEventDate(demoEvent.startsAt)}</p>
          </div>
          <WalletCards className="text-wave" aria-hidden />
        </div>
      </div>

      {demoTickets.map((ticket) => (
        <Link
          key={ticket.id}
          to="/entradas/abierta"
          className="flex items-center gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm hover:border-brand"
        >
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-slate-100">
            <QrCode size={30} aria-hidden />
          </span>
          <span className="flex-1">
            <Badge tone="valid">{ticket.status}</Badge>
            <span className="mt-1 block font-black">Entrada {ticket.type}</span>
            <span className="text-sm text-slate-600">{ticket.holder}</span>
          </span>
          <ChevronRight className="text-slate-400" aria-hidden />
        </Link>
      ))}

      <Button variant="secondary" className="w-full">
        Mostrar todas en la puerta ({demoTickets.length})
      </Button>

      <Notice icon={Smartphone} title="Instale PassRipple en su teléfono">
        En iPhone: Compartir → Agregar a inicio. En Android: menú → Instalar app. Sus entradas
        quedan a un toque, incluso sin señal.
      </Notice>

      <div className="flex flex-col gap-2 text-sm font-bold text-brand">
        <Link to="/recuperar" className="min-h-11 py-3">
          ¿Cambió de teléfono? Recupere sus entradas
        </Link>
        <Link to="/mis-datos" className="min-h-11 py-3">
          Mis datos y preferencias
        </Link>
      </div>
    </div>
  );
}

/** Seconds left in the current QR window. Windows are aligned to the clock, like the signer. */
function qrSecondsLeft(): number {
  return QR_WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % QR_WINDOW_SECONDS);
}

function useQrWindow(): number {
  const [remaining, setRemaining] = useState(qrSecondsLeft);
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(qrSecondsLeft()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return remaining;
}

/** An open ticket: the QR is re-signed every 30 seconds; the static code is the fallback. */
export function TicketView() {
  const ticket = demoTickets[0];
  const remaining = useQrWindow();
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-ink p-4 shadow-xl">
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between text-xs font-black">
            <span>{demoEvent.name.toUpperCase()}</span>
            <Badge tone="valid">{ticket.status}</Badge>
          </div>
          <div className="relative mx-auto my-6 grid aspect-square w-full max-w-72 place-items-center rounded-2xl bg-ink">
            {/* Placeholder: the real QR is drawn from the device-bound credential. */}
            <QrCode
              className="size-3/5 text-white"
              strokeWidth={1}
              aria-label="Código QR de la entrada"
            />
          </div>
          <p className="text-xs font-bold text-slate-600">ENTRADA {ticket.type.toUpperCase()}</p>
          <h1 className="mt-1 text-2xl font-black">{ticket.holder}</h1>
          <p className="mt-1 text-sm text-slate-600">{formatEventDate(demoEvent.startsAt)}</p>
          <div className="mt-4 border-t border-line pt-3">
            <Row
              label="Código de respaldo"
              value={<span className="font-mono">{ticket.code}</span>}
            />
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 py-4 text-sm text-slate-300">
          <svg viewBox="0 0 100 100" className="size-7 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#334155" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="var(--color-wave)"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - remaining / QR_WINDOW_SECONDS)}
              strokeLinecap="round"
            />
          </svg>
          <span aria-live="off">El código cambia en {remaining} s</span>
        </div>
      </div>
      <Notice icon={ShieldCheck} title="Una captura de pantalla no sirve">
        El código cambia cada 30 segundos y se usa una sola vez. Muestre esta pantalla en la puerta.
      </Notice>
      <div className="grid grid-cols-2 gap-3">
        <ButtonLink to="/transferir" variant="secondary">
          <Share2 size={17} aria-hidden /> Transferir
        </ButtonLink>
        <ButtonLink to="/asignar" variant="secondary">
          Asignar asistente
        </ButtonLink>
      </div>
    </div>
  );
}

/** Free transfer through a private link that the receiver opens on their phone. */
export function Transfer() {
  const ticket = demoTickets[1];
  const [link, setLink] = useState<string | null>(null);
  const message = encodeURIComponent(`Le paso una entrada para ${demoEvent.name}: ${link ?? ""}`);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Transferir entrada</h1>
      <Card>
        <Row label="Entrada" value={`${ticket.type} · ${ticket.holder}`} />
        <Row label="Costo" value="Sin cobro" />
        <p className="mt-3 text-sm text-slate-600">
          Al recibirla, la entrada queda en el teléfono de la otra persona y deja de funcionar en el
          suyo.
        </p>
        {link ? (
          <div className="mt-4 space-y-3">
            <p className="break-all rounded-xl bg-slate-50 p-4 font-mono text-sm">{link}</p>
            <a
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-valid px-5 font-bold text-white"
              href={`https://wa.me/?text=${message}`}
              target="_blank"
              rel="noreferrer"
            >
              Enviar por WhatsApp
            </a>
          </div>
        ) : (
          <Button
            className="mt-4 w-full"
            onClick={() => setLink("https://app.passripple.example/r/demo")}
          >
            <Link2 size={17} aria-hidden /> Crear enlace privado
          </Button>
        )}
      </Card>
      <Card>
        <h2 className="font-bold">Así lo ve quien la recibe</h2>
        <p className="mt-1 text-sm text-slate-600">
          {ticket.holder} le pasó una entrada General para {demoEvent.name}.
        </p>
        <Button variant="brand" className="mt-4 w-full" disabled>
          Recibir en este teléfono
        </Button>
      </Card>
    </div>
  );
}

/** Recovery when a ticket is bound to another phone: contact → code → done. */
export function Recover() {
  const [step, setStep] = useState(0);
  const next = (event: FormEvent) => {
    event.preventDefault();
    setStep(step + 1);
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Recuperar mis entradas</h1>
      <Notice icon={Smartphone} title="Esta entrada está vinculada a otro teléfono" tone="verify">
        Si cambió de teléfono, la pasamos a este. El anterior deja de poder usarla.
      </Notice>
      <Steps steps={["Contacto", "Código", "Listo"]} current={step} />
      <Card>
        {step === 0 && (
          <form onSubmit={next} className="space-y-4">
            <Field label="Correo o teléfono con que compró" required autoComplete="email" />
            <Button submit className="w-full">
              Enviarme un código
            </Button>
          </form>
        )}
        {step === 1 && (
          <form onSubmit={next} className="space-y-4">
            <Field
              label="Código de 6 dígitos"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              hint="Vence en 10 minutos."
            />
            <Button submit className="w-full">
              Recuperar
            </Button>
          </form>
        )}
        {step === 2 && (
          <div className="text-center">
            <ShieldCheck size={40} className="mx-auto text-valid" aria-hidden />
            <p className="mt-3 font-black">Sus entradas están en este teléfono</p>
            <p className="mt-1 text-sm text-slate-600">El teléfono anterior ya no puede usarlas.</p>
            <ButtonLink to="/entradas" className="mt-5 w-full">
              Ver mis entradas
            </ButtonLink>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Named attendee for 18+ events: the gate checks the document against this name. */
export function AssignAttendee() {
  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      <h1 className="text-2xl font-black">Asignar asistente</h1>
      <p className="text-slate-600">
        Este evento es para mayores de 18. En la puerta se revisa el documento de quien entra.
      </p>
      <Card className="space-y-4">
        <Field label="Nombre completo" required autoComplete="name" />
        <div>
          <label htmlFor="document-type" className="block text-sm font-bold">
            Tipo de documento
          </label>
          <select
            id="document-type"
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4"
          >
            <option>Cédula</option>
            <option>DIMEX</option>
            <option>Pasaporte</option>
            <option>TIM</option>
          </select>
        </div>
        <Field label="Número de documento" required />
        <p className="text-xs leading-5 text-slate-600">
          Usamos estos datos solo para el control de edad de este evento y los borramos cuando
          termina el plazo de conservación.
        </p>
        <Button submit className="w-full">
          Guardar asistente
        </Button>
      </Card>
    </form>
  );
}

/** The buyer's own data: download, delete and preferences. */
export function MyData() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Mis datos</h1>
      <Card>
        <Row label="Contacto" value="a•••@correo.com" />
        <Row label="Órdenes" value="1" />
      </Card>
      <Card>
        <h2 className="font-bold">Descargar mis datos</h2>
        <p className="mt-1 text-sm text-slate-600">
          Un archivo con todo lo que guardamos sobre usted.
        </p>
        <Button variant="secondary" className="mt-4 w-full">
          <Download size={17} aria-hidden /> Descargar
        </Button>
      </Card>
      <Card>
        <h2 className="font-bold">Preferencias</h2>
        <Checkbox label="Recibir novedades de PassRipple" />
      </Card>
      <Card>
        <h2 className="font-bold">Eliminar mis datos</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tiene entradas para un evento que todavía no ocurre. Puede transferirlas antes, o eliminar
          sus datos cuando el evento termine.
        </p>
        <Button variant="danger" className="mt-4 w-full">
          <Trash2 size={17} aria-hidden /> Eliminar mis datos
        </Button>
      </Card>
    </div>
  );
}
