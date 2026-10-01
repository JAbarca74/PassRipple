import type { LucideIcon } from "lucide-react";
import {
  ChevronRight,
  CreditCard,
  FileCheck2,
  Landmark,
  LayoutDashboard,
  Link2,
  QrCode,
  Receipt,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  UserRoundPen,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname } from "./router.tsx";
import { Admin } from "./screens/admin/admin.tsx";
import { Payment, Purchase, WaitingRoom } from "./screens/buyer/checkout.tsx";
import {
  AssignAttendee,
  MyData,
  Recover,
  TicketView,
  Transfer,
  Wallet,
} from "./screens/buyer/wallet.tsx";
import { MunicipalPortal } from "./screens/municipal/municipal.tsx";
import {
  CreateEvent,
  OrganizerDashboard,
  Settlement,
  Staff,
} from "./screens/organizer/organizer.tsx";
import { Logo } from "./ui/Logo.tsx";
import { BuyerLayout } from "./ui/layouts.tsx";
import { ButtonLink } from "./ui/ui.tsx";

type Route = {
  path: string;
  title: string;
  area: "Compra" | "Billetera" | "Organizador" | "Administración" | "Municipalidad";
  icon: LucideIcon;
  render: () => ReactNode;
};

const buyer = (screen: ReactNode) => () => <BuyerLayout>{screen}</BuyerLayout>;

const routes: readonly Route[] = [
  {
    path: "/comprar",
    title: "Comprar entradas",
    area: "Compra",
    icon: CreditCard,
    render: buyer(<Purchase />),
  },
  {
    path: "/pagar",
    title: "Pago con SINPE",
    area: "Compra",
    icon: Landmark,
    render: buyer(<Payment />),
  },
  {
    path: "/espera",
    title: "Sala de espera",
    area: "Compra",
    icon: Zap,
    render: buyer(<WaitingRoom />),
  },
  {
    path: "/entradas",
    title: "Mis entradas",
    area: "Billetera",
    icon: WalletCards,
    render: buyer(<Wallet />),
  },
  {
    path: "/entradas/abierta",
    title: "Entrada abierta",
    area: "Billetera",
    icon: QrCode,
    render: buyer(<TicketView />),
  },
  {
    path: "/transferir",
    title: "Transferir entrada",
    area: "Billetera",
    icon: Link2,
    render: buyer(<Transfer />),
  },
  {
    path: "/recuperar",
    title: "Recuperar entradas",
    area: "Billetera",
    icon: RotateCcw,
    render: buyer(<Recover />),
  },
  {
    path: "/asignar",
    title: "Asignar asistente",
    area: "Billetera",
    icon: UserRoundPen,
    render: buyer(<AssignAttendee />),
  },
  {
    path: "/mis-datos",
    title: "Mis datos",
    area: "Billetera",
    icon: Settings2,
    render: buyer(<MyData />),
  },
  {
    path: "/organizador",
    title: "Dashboard en vivo",
    area: "Organizador",
    icon: LayoutDashboard,
    render: () => <OrganizerDashboard />,
  },
  {
    path: "/organizador/crear",
    title: "Crear evento",
    area: "Organizador",
    icon: FileCheck2,
    render: () => <CreateEvent />,
  },
  {
    path: "/organizador/staff",
    title: "Staff y dispositivos",
    area: "Organizador",
    icon: Smartphone,
    render: () => <Staff />,
  },
  {
    path: "/organizador/liquidacion",
    title: "Liquidación",
    area: "Organizador",
    icon: Receipt,
    render: () => <Settlement />,
  },
  {
    path: "/admin",
    title: "Operación",
    area: "Administración",
    icon: ShieldCheck,
    render: () => <Admin />,
  },
  {
    path: "/municipalidad",
    title: "Portal municipal",
    area: "Municipalidad",
    icon: Users,
    render: () => <MunicipalPortal />,
  },
];

export function App() {
  const pathname = usePathname();
  if (pathname === "/") return <ScreenIndex />;
  const route = routes.find((candidate) => candidate.path === pathname);
  return route ? route.render() : <NotFound />;
}

/** Entry page while the app runs on demonstration data: every screen, grouped by area. */
function ScreenIndex() {
  const areas = [...new Set(routes.map((route) => route.area))];
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Logo />
      <h1 className="mt-8 text-4xl font-black tracking-tight">Pantallas de la aplicación</h1>
      <p className="mt-2 text-slate-600">Datos de demostración, sin conexión a la API.</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((area) => (
          <section key={area} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="font-black">{area}</h2>
            <ul className="mt-3 space-y-2">
              {routes
                .filter((route) => route.area === area)
                .map((route) => (
                  <li key={route.path}>
                    <Link
                      to={route.path}
                      className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-100 px-3 text-sm font-semibold hover:border-brand hover:bg-brand-soft"
                    >
                      <route.icon size={16} className="text-slate-600" aria-hidden />
                      <span className="flex-1">{route.title}</span>
                      <ChevronRight size={16} className="text-slate-400" aria-hidden />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <BuyerLayout>
      <h1 className="text-2xl font-black">No encontramos esta página</h1>
      <p className="mt-2 text-slate-600">Revise el enlace o vuelva a sus entradas.</p>
      <ButtonLink to="/entradas" className="mt-6 w-full">
        Ir a mis entradas
      </ButtonLink>
    </BuyerLayout>
  );
}
