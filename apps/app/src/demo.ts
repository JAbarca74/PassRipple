// Static demonstration data. Every name, code, number and amount here is invented.
// Screens read from this file until the API exists, so replacing it is the integration point.

/** Invented service charge per ticket. The real one comes frozen in each order (invariant I5). */
export const DEMO_SERVICE_CHARGE = 300;

/** Maximum tickets in one order in the demo. */
export const DEMO_MAX_PER_ORDER = 4;

export const demoEvent = {
  name: "Motocross Pejibaye",
  startsAt: new Date("2026-11-14T19:00:00Z"),
  venue: "Finca El Llano, Pejibaye",
  canton: "Pérez Zeledón",
  organizer: "Asociación Deportiva Pejibaye",
  capacity: 500,
  rating: "Todo público",
} as const;

export type TicketType = {
  id: string;
  name: string;
  price: number;
  availability: "Disponible" | "Quedan pocas" | "Agotado";
};

export const ticketTypes: readonly TicketType[] = [
  { id: "general", name: "General", price: 5000, availability: "Quedan pocas" },
  { id: "sombra", name: "Sombra", price: 7000, availability: "Disponible" },
  { id: "vip", name: "VIP", price: 12000, availability: "Disponible" },
];

export const demoOrder = {
  code: "K7NP9X",
  quantity: 2,
  ticketType: "General",
  unitPrice: 5000,
  /** Placeholder: the collection number is configuration, never code. */
  sinpeNumber: "0000-0000",
  holdSeconds: 29 * 60 + 41,
} as const;

export const demoTickets = [
  { id: "t1", holder: "Ana Ejemplo", type: "General", code: "4K7NP-9XR2M", status: "Activa" },
  { id: "t2", holder: "Luis Ejemplo", type: "General", code: "7QW3H-2MC8D", status: "Activa" },
] as const;

/** Total an order shows before paying: tickets plus the service charge, always itemized. */
export function orderTotals(unitPrice: number, quantity: number) {
  const tickets = unitPrice * quantity;
  const serviceCharge = DEMO_SERVICE_CHARGE * quantity;
  return { tickets, serviceCharge, total: tickets + serviceCharge };
}
