/**
 * La localización española de Clerk deja sin traducir buena parte de la
 * facturación: la tabla de planes salía con «Active», «Billed monthly» o
 * «Renews…». Aquí se completa (solo lo que falta) sobre `esES`.
 */
import { esES } from '@clerk/localizations';

const fecha = (texto: string) => `${texto} {{ date | shortDate('es-ES') }}`;

const faltantes = {
  badge__activePlan: 'Activo',
  badge__banned: 'Bloqueado',
  badge__canceledEndsAt: fecha('Cancelado · termina el'),
  badge__currentPlan: 'Plan actual',
  badge__deprovisioned: 'Dado de baja',
  badge__endsAt: fecha('Termina el'),
  badge__expired: 'Caducado',
  badge__freeTrial: 'Prueba gratuita',
  badge__pastDueAt: fecha('Pago pendiente desde el'),
  badge__pastDuePlan: 'Pago pendiente',
  badge__renewsAt: fecha('Se renueva el'),
  badge__startsAt: fecha('Empieza el'),
  badge__trialEndsAt: fecha('La prueba termina el'),
  badge__upcomingPlan: 'Próximo',
  billing: {
    accountCredit: 'Saldo de la cuenta',
    billedAnnuallyOnly: 'Solo facturación anual',
    billedMonthly: 'Facturación mensual',
    checkout: {
      addPromoCode: 'Añadir código promocional',
      applyPromoCode: 'Aplicar',
      discount: 'Descuento',
      promoCodePlaceholder: 'Escribe el código',
      removePromoCode: 'Quitar el código',
      totalDuePerPeriod: 'Total por periodo',
    },
    discountAmount: '{{amount}} de descuento',
    discountCyclesRemaining: 'Quedan {{cycles}} {{period}}',
    discountDuration: '{{amount}} de descuento los primeros {{cycles}} {{period}}',
    monthAbbreviation: 'mes',
    monthPerUnit: 'Mes por {{unitName}}',
    months: 'Meses',
    payerCreditRemainder: 'Saldo de la cuenta.',
    pricingTable: {
      seatCost: {
        additionalSeats: '({{additionalTierFeePerBlockAmount}}/{{periodAbbreviation}} por cada plaza más)',
        freeUpToSeats: 'Gratis hasta {{endsAfterBlock}} plazas',
        includedSeats: '{{includedSeats}} plazas incluidas',
        perSeat: '{{feePerBlockAmount}}/{{periodAbbreviation}} por plaza',
        tooltip: {
          additionalSeatsEach: 'Cada plaza adicional cuesta {{feePerBlockAmount}}/{{period}}.',
          firstSeatsIncludedInPlan: 'Las primeras {{endsAfterBlock}} plazas van incluidas en el plan.',
          freeForUpToSeats: 'Gratis hasta {{endsAfterBlock}} plazas.',
        },
        unlimitedSeats: 'Plazas ilimitadas',
        upToSeats: 'Hasta {{endsAfterBlock}} plazas',
      },
    },
    proratedDiscount: 'Descuento prorrateado',
    prorationCredit: 'Saldo prorrateado',
    seatBreakdownIncludedPlural: '{{chargeable}} plazas a {{rate}}/mes ({{totalSeats}} en total, {{included}} incluidas)',
    seatBreakdownIncludedSingular: '1 plaza a {{rate}}/mes ({{totalSeats}} en total, {{included}} incluidas)',
    seatBreakdownPlural: '{{chargeable}} plazas a {{rate}}/mes',
    seatBreakdownSingular: '1 plaza a {{rate}}/mes',
    seats: 'Plazas',
    seatsWithLimit: 'Plazas (hasta {{limit}})',
    subtotalRenewal: 'Subtotal por periodo',
    totalDuePerPeriod: 'Total por periodo',
    yearAbbreviation: 'año',
    yearPerUnit: 'Año por {{unitName}}',
    years: 'Años',
  },
  userProfile: {
    billingPage: {
      accountCreditsSection: { title: 'Saldo de la cuenta', viewHistory: 'Ver el historial del saldo' },
      creditHistoryPage: { tableHeader__amount: 'Importe', tableHeader__date: 'Fecha', title: 'Historial del saldo' },
      statementsSection: { itemCaption__payerCredit: 'Saldo de la cuenta' },
      subscriptionsListSection: { overview: 'Resumen' },
    },
    navbar: { billing: 'Facturación' },
    plansPage: { title: 'Planes' },
  },
};

type Objeto = Record<string, unknown>;
const esObjeto = (v: unknown): v is Objeto => !!v && typeof v === 'object' && !Array.isArray(v);

/** Completa `base` con `extra` solo donde `base` no tiene nada. */
function completar(base: Objeto, extra: Objeto): Objeto {
  const r: Objeto = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (esObjeto(v)) r[k] = completar(esObjeto(base[k]) ? base[k] : {}, v);
    else if (base[k] === undefined) r[k] = v;
  }
  return r;
}

export const localizacionClerk = completar(esES as unknown as Objeto, faltantes) as unknown as typeof esES;
