import { Download, Landmark, TriangleAlert } from "lucide-react";
import { demoEvent } from "../../demo.ts";
import { formatColones, formatEventDate } from "../../lib/format.ts";
import { PanelLayout } from "../../ui/layouts.tsx";
import { Badge, Button, Card, CardTitle, Notice, PageHeader, Row } from "../../ui/ui.tsx";

const municipalNav = [{ to: "/municipalidad", label: "Portal", icon: Landmark }] as const;

export function MunicipalPortal() {
  const requests = [
    { event: "Baile de Fin de Año", organizer: "Comité de Festejos de Ejemplo", capacity: 300 },
    { event: "Torneo Regional", organizer: "Asociación Deportiva Pejibaye", capacity: 800 },
  ];
  return (
    <PanelLayout area={`Municipalidad de ${demoEvent.canton}`} nav={municipalNav}>
      <PageHeader
        eyebrow="Fiscalización"
        title={`Municipalidad de ${demoEvent.canton}`}
        description="Solicitudes, eventos en curso y declaraciones."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Solicitudes de autorización</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {requests.map((request) => (
              <li key={request.event} className="py-3 text-sm">
                <p className="font-semibold">{request.event}</p>
                <p className="text-slate-600">
                  {request.organizer} · Aforo {request.capacity}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button className="min-h-10 px-3 text-sm">Autorizar</Button>
                  <Button variant="secondary" className="min-h-10 px-3 text-sm">
                    Pedir corrección
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle action={<Badge tone="valid">En vivo</Badge>}>Eventos en curso</CardTitle>
          <div className="mt-3">
            <p className="font-semibold">{demoEvent.name}</p>
            <p className="text-sm text-slate-600">{formatEventDate(demoEvent.startsAt)}</p>
            <div
              className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Personas dentro respecto del aforo"
              aria-valuenow={472}
              aria-valuemin={0}
              aria-valuemax={demoEvent.capacity}
            >
              <div className="h-full rounded-full bg-verify" style={{ width: "94%" }} />
            </div>
            <p className="mt-2 text-sm font-bold">472 de {demoEvent.capacity} personas</p>
          </div>
          <div className="mt-4">
            <Notice icon={TriangleAlert} title="Cerca del aforo autorizado" tone="verify">
              El evento está por encima del 90 % de su aforo.
            </Notice>
          </div>
        </Card>
        <Card>
          <CardTitle>Declaración posterior al evento</CardTitle>
          <div className="mt-3 divide-y divide-line">
            <Row label="Evento" value="Festival Deportivo" />
            <Row label="Entradas vendidas" value="612" />
            <Row label="Cortesías" value="25" />
            <Row label="Recaudación declarada" value={formatColones(3060000)} />
            <Row
              label="Hash de la bitácora"
              value={<span className="font-mono text-xs">9f2c…a71e</span>}
            />
          </div>
          <p className="mt-3 text-xs text-slate-600">
            El organizador paga el impuesto. PassRipple prepara los datos.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="flex-1">
              <Download size={16} aria-hidden /> PDF
            </Button>
            <Button variant="secondary" className="flex-1">
              <Download size={16} aria-hidden /> CSV
            </Button>
          </div>
        </Card>
        <Card>
          <CardTitle action={<Badge>Solo lectura</Badge>}>Reglas del cantón</CardTitle>
          <p className="mt-3 text-sm text-slate-600">
            Las reglas de impuesto y fiscalización de cada cantón se cargan como datos y solo se
            muestran aquí.
          </p>
        </Card>
      </div>
    </PanelLayout>
  );
}
