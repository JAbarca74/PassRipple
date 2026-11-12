// The municipal portal (design 12): the authorizations waiting for the municipality, the
// events of its canton with their live count, the declaration of each event (JSON on screen,
// CSV to download, PDF through the browser's print) and inspector mode, which checks a ticket
// by its code without admitting it. Officials decide; inspectors only watch and verify.
// The organizer pays the tax: PassRipple only prepares the data.

import type {
  AuthorizationsResponse,
  Declaration,
  MunicipalEvent,
  MunicipalEventsResponse,
  VerifyTicketResponse,
} from "@passripple/contracts";
import { declarationCsv } from "@passripple/tax";
import {
  CircleCheck,
  CircleX,
  Download,
  Landmark,
  LogOut,
  Printer,
  Search,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { failureText, PanelGate, usePanel } from "../../lib/panel.tsx";
import { PanelLayout } from "../../ui/layouts.tsx";
import { Badge, Button, Card, CardTitle, Field, Notice, PageHeader, Row } from "../../ui/ui.tsx";

const municipalNav = [{ to: "/municipalidad", label: "Portal", icon: Landmark }] as const;

/** How often the live counts refresh while the portal is open. */
const REFRESH_MS = 15_000;

export function MunicipalPortal() {
  return (
    <PanelGate kind="municipal">
      <PanelLayout area="Municipalidad" nav={municipalNav}>
        <Portal />
      </PanelLayout>
    </PanelGate>
  );
}

function Portal() {
  const panel = usePanel();
  const isOfficial = panel.profile.municipal.some((access) => access.kind === "official");
  const [requests, setRequests] = useState<AuthorizationsResponse["authorizations"] | null>(null);
  const [events, setEvents] = useState<readonly MunicipalEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [auths, evts] = await Promise.all([
        panel.call<AuthorizationsResponse>("/municipal/authorizations"),
        panel.call<MunicipalEventsResponse>("/municipal/events"),
      ]);
      setRequests(auths.authorizations);
      setEvents(evts.events);
      setError(null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [panel]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const cantons = panel.profile.municipal.map((access) => access.canton).join(", ");
  const waiting = requests?.filter((request) => request.status === "requested") ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Fiscalización"
        title="Portal municipal"
        description={`Cantón: ${cantons}. ${isOfficial ? "Puede autorizar y declarar." : "Puede verificar y mirar el conteo."}`}
        action={
          <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={panel.signOut}>
            <LogOut size={16} aria-hidden /> Salir
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <Notice icon={TriangleAlert} title="No pudimos cargar los datos" tone="verify">
            {error}
          </Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Badge>{waiting.length} por revisar</Badge>}>
            Solicitudes de autorización
          </CardTitle>
          {requests?.length === 0 && (
            <p className="mt-3 text-sm text-slate-600">Ninguna solicitud todavía.</p>
          )}
          <ul className="mt-3 divide-y divide-line">
            {requests?.map((request) => (
              <Request
                key={request.authorizationId}
                request={request}
                canDecide={isOfficial}
                onDecided={load}
              />
            ))}
          </ul>
        </Card>
        <Verify />
        <Card className="lg:col-span-2">
          <CardTitle action={<Badge tone="valid">En vivo</Badge>}>Eventos del cantón</CardTitle>
          {events?.length === 0 && (
            <p className="mt-3 text-sm text-slate-600">Ningún evento publicado todavía.</p>
          )}
          <ul className="mt-3 divide-y divide-line">
            {events?.map((event) => (
              <EventLine
                key={event.eventId}
                event={event}
                open={selected === event.eventId}
                onToggle={() => setSelected(selected === event.eventId ? null : event.eventId)}
              />
            ))}
          </ul>
        </Card>
        {selected && <DeclarationCard eventId={selected} />}
      </div>
    </>
  );
}

function Request({
  request,
  canDecide,
  onDecided,
}: {
  request: AuthorizationsResponse["authorizations"][number];
  canDecide: boolean;
  onDecided: () => Promise<void>;
}) {
  const panel = usePanel();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      await panel.call(`/municipal/authorizations/${request.authorizationId}/decision`, {
        method: "POST",
        body: { approve, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      });
      await onDecided();
    } catch (failure) {
      setError(failureText(failure));
      setBusy(false);
    }
  }

  const tone =
    request.status === "authorized"
      ? "valid"
      : request.status === "rejected"
        ? "verify"
        : "neutral";
  const label =
    request.status === "authorized"
      ? "Autorizada"
      : request.status === "rejected"
        ? "Devuelta"
        : "Por revisar";

  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{request.eventName}</p>
          <p className="text-slate-600">
            {request.organization} · {formatEventDate(new Date(request.startsAt))} · Aforo{" "}
            {request.permittedCapacity}
          </p>
          <p className="text-slate-600">
            Permiso {request.permitNumber ?? "sin número"} · Impuesto máximo estimado{" "}
            {formatColones(request.estimatedTaxCrc)}
          </p>
          {request.reference && <p className="font-mono text-xs">{request.reference}</p>}
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>
      {request.status === "requested" && canDecide && (
        <div className="mt-3 space-y-3">
          <Field
            label="Observaciones (opcional)"
            value={notes}
            onChange={(change) => setNotes(change.target.value)}
            maxLength={500}
          />
          <div className="flex gap-2">
            <Button
              className="min-h-10 px-3 text-sm"
              disabled={busy}
              onClick={() => void decide(true)}
            >
              Autorizar
            </Button>
            <Button
              variant="secondary"
              className="min-h-10 px-3 text-sm"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Pedir corrección
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </li>
  );
}

function EventLine({
  event,
  open,
  onToggle,
}: {
  event: MunicipalEvent;
  open: boolean;
  onToggle: () => void;
}) {
  const { counts } = event;
  const used = counts.capacity === 0 ? 0 : Math.round((counts.redeemed / counts.capacity) * 100);
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{event.name}</p>
          <p className="text-slate-600">
            {event.organization} · {formatEventDate(new Date(event.startsAt))}
          </p>
        </div>
        <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={onToggle}>
          {open ? "Ocultar declaración" : "Ver declaración"}
        </Button>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="Personas dentro respecto del aforo"
        aria-valuenow={counts.redeemed}
        aria-valuemin={0}
        aria-valuemax={counts.capacity}
      >
        <div
          className="h-full rounded-full bg-verify"
          style={{ width: `${Math.min(used, 100)}%` }}
        />
      </div>
      <p className="mt-2 font-bold">
        {counts.redeemed} de {counts.capacity} personas dentro
      </p>
      <p className="text-slate-600">
        Emitidas {counts.issued} · En línea {counts.soldOnline} · En puerta {counts.doorSales} ·
        Cortesías {counts.courtesies} · Anuladas {counts.voided}
      </p>
      {counts.capacity > 0 && counts.redeemed / counts.capacity > 0.9 && (
        <p className="mt-1 text-xs font-bold text-amber-700">Por encima del 90 % del aforo.</p>
      )}
    </li>
  );
}

function DeclarationCard({ eventId }: { eventId: string }) {
  const panel = usePanel();
  const [declaration, setDeclaration] = useState<Declaration | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDeclaration(null);
    panel
      .call<Declaration>(`/municipal/events/${eventId}/declaration`)
      .then((result) => {
        if (!cancelled) setDeclaration(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failureText(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [panel, eventId]);

  if (error) {
    return (
      <Notice icon={TriangleAlert} title="No pudimos generar la declaración" tone="verify">
        {error}
      </Notice>
    );
  }
  if (!declaration) return <p className="text-sm text-slate-600">Generando declaración…</p>;

  const { figures } = declaration;
  const paid = figures.types.reduce((sum, type) => sum + type.online + type.door, 0);
  const courtesies = figures.types.reduce((sum, type) => sum + type.courtesies, 0);
  const redeemed = figures.types.reduce((sum, type) => sum + type.redeemed, 0);

  function download() {
    const blob = new Blob([declarationCsv(declaration as Declaration)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `declaracion-${eventId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Declaración: {figures.event.name}</CardTitle>
      <div className="mt-3 grid gap-x-8 lg:grid-cols-2">
        <div className="divide-y divide-line">
          <Row label="Organizador" value={figures.organization} />
          <Row label="Permiso" value={figures.event.permitNumber ?? "Sin número"} />
          <Row
            label="Autorización de emisión"
            value={figures.event.emissionAuth ?? "Sin autorizar"}
          />
          <Row label="Entradas pagadas" value={String(paid)} />
          <Row label="Cortesías" value={String(courtesies)} />
          <Row label="Canjeadas" value={String(redeemed)} />
        </div>
        <div className="divide-y divide-line">
          <Row label="Monto bruto" value={formatColones(declaration.grossCrc)} />
          <Row
            label="Cortesías en exceso"
            value={`${figures.courtesy.excess} (${formatColones(declaration.courtesyExcessCrc)})`}
          />
          <Row label="Base imponible" value={formatColones(declaration.taxableBaseCrc)} />
          <Row
            label={`Impuesto (${figures.rules.taxRateBps / 100} %)`}
            value={formatColones(declaration.taxCrc)}
          />
          <Row label="Fecha de liquidación" value={declaration.dueDate ?? "Según el reglamento"} />
          <Row
            label="Hash de la bitácora"
            value={<span className="break-all font-mono text-xs">{figures.logHash}</span>}
          />
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-600">
            <tr>
              <th className="py-2 pr-3">Tipo</th>
              <th className="py-2 pr-3">Precio</th>
              <th className="py-2 pr-3">En línea</th>
              <th className="py-2 pr-3">En puerta</th>
              <th className="py-2 pr-3">Cortesías</th>
              <th className="py-2 pr-3">Canjeadas</th>
              <th className="py-2">Anuladas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {figures.types.map((type) => (
              <tr key={type.name}>
                <td className="py-2 pr-3 font-semibold">{type.name}</td>
                <td className="py-2 pr-3">{formatColones(type.priceCrc)}</td>
                <td className="py-2 pr-3">{type.online}</td>
                <td className="py-2 pr-3">{type.door}</td>
                <td className="py-2 pr-3">{type.courtesies}</td>
                <td className="py-2 pr-3">{type.redeemed}</td>
                <td className="py-2">{type.voided}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-600">
        El organizador declara y paga el impuesto. PassRipple prepara los datos y nunca recibe ese
        dinero. Cualquier cambio posterior en las entradas o los canjes cambia el hash.
      </p>
      <div className="mt-4 flex gap-2 print:hidden">
        <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
          <Printer size={16} aria-hidden /> PDF (imprimir)
        </Button>
        <Button variant="secondary" className="flex-1" onClick={download}>
          <Download size={16} aria-hidden /> CSV
        </Button>
      </div>
    </Card>
  );
}

const REASONS: Record<VerifyTicketResponse["reason"], string> = {
  ok: "Entrada válida, sin canjear.",
  void: "Entrada anulada.",
  unsold: "Entrada de un bloque de puerta que no se vendió.",
  already_admitted: "Entrada válida pero ya se usó para entrar.",
  unknown: "No encontramos esa entrada en su cantón.",
};

/** Inspector mode: checks a ticket by its code. It never admits anyone. */
function Verify() {
  const panel = usePanel();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<VerifyTicketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setResult(
        await panel.call<VerifyTicketResponse>("/municipal/verify", {
          method: "POST",
          body: { code },
        }),
      );
      setError(null);
    } catch (failure) {
      setResult(null);
      setError(failureText(failure));
    }
  }

  return (
    <Card>
      <CardTitle>Modo inspector</CardTitle>
      <p className="mt-2 text-sm text-slate-600">
        Escriba el código de la entrada para verificarla sin canjearla.
      </p>
      <form className="mt-3 flex items-end gap-3" onSubmit={submit}>
        <Field
          className="flex-1"
          label="Código de la entrada"
          value={code}
          onChange={(change) => setCode(change.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <Button submit disabled={code.trim().length < 4}>
          <Search size={16} aria-hidden /> Verificar
        </Button>
      </form>
      {error && <p className="mt-3 text-sm font-bold text-red-700">{error}</p>}
      {result && (
        <div className="mt-4">
          <Notice
            icon={result.valid ? CircleCheck : CircleX}
            title={result.valid ? "Válida" : "No válida"}
            tone={result.valid ? "valid" : "verify"}
          >
            {REASONS[result.reason]}
            {result.eventName && (
              <>
                {" "}
                {result.eventName}
                {result.ticketType ? ` · ${result.ticketType}` : ""}
              </>
            )}
          </Notice>
        </div>
      )}
    </Card>
  );
}
