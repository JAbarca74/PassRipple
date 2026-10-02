import { BellRing, ShieldCheck } from "lucide-react";
import { formatColones } from "../../lib/format.ts";
import { PanelLayout } from "../../ui/layouts.tsx";
import { Badge, Button, Card, CardTitle, Notice, PageHeader, Stat } from "../../ui/ui.tsx";

const adminNav = [{ to: "/admin", label: "Operación", icon: ShieldCheck }] as const;

export function Admin() {
  const unreconciled = [
    { ref: "SINPE ••••2210", amount: 5300, received: "Hace 8 min", note: "Sin código de orden" },
    { ref: "SINPE ••••7781", amount: 10000, received: "Hace 21 min", note: "Monto distinto" },
  ];
  const verifications = [
    { name: "Asociación Deportiva Pejibaye", status: "Verificada", tone: "valid" },
    { name: "Comité de Festejos de Ejemplo", status: "En revisión", tone: "verify" },
  ] as const;
  const payoutsDue = [
    { event: "Motocross Pejibaye", due: "Vence mañana", amount: 1909400 },
    { event: "Festival Deportivo", due: "Vence en 3 días", amount: 845000 },
  ];
  return (
    <PanelLayout area="Administración" nav={adminNav}>
      <PageHeader eyebrow="Administración" title="Operación" />
      <Notice icon={BellRing} title="Último aviso bancario hace 3 min" tone="valid">
        Si dejan de llegar avisos en horario de ventas, aquí aparece una alerta.
      </Notice>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="En custodia" value={formatColones(2140000)} />
        <Stat label="Ingresos propios" value={formatColones(128400)} />
        <Stat label="Pagos sin conciliar" value="2" />
        <Stat label="Incidentes abiertos" value="1" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Pagos sin conciliar</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {unreconciled.map((payment) => (
              <li
                key={payment.ref}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  <span className="block font-mono font-semibold">{payment.ref}</span>
                  <span className="text-slate-600">
                    {payment.received} · {payment.note}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{formatColones(payment.amount)}</span>
                  <Button variant="secondary" className="min-h-10 px-3 text-sm">
                    Asignar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Verificación de organizadores</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {verifications.map((organizer) => (
              <li key={organizer.name} className="flex items-center justify-between py-3 text-sm">
                <span className="font-semibold">{organizer.name}</span>
                <Badge tone={organizer.tone}>{organizer.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Liquidaciones por vencer</CardTitle>
          <ul className="mt-3 divide-y divide-line">
            {payoutsDue.map((payout) => (
              <li key={payout.event} className="flex items-center justify-between py-3 text-sm">
                <span>
                  <span className="block font-semibold">{payout.event}</span>
                  <span className="text-slate-600">{payout.due}</span>
                </span>
                <span className="font-semibold">{formatColones(payout.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Cobros que no aparecen en el estado de cuenta</CardTitle>
          <p className="mt-3 text-sm text-slate-600">
            Ninguno. La última conciliación contra el estado de cuenta cuadró.
          </p>
        </Card>
      </div>
    </PanelLayout>
  );
}
