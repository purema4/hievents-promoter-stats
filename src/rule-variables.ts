/*
 * What a promoter rule can read and what it can give. The one list of both: the rules engine is told
 * these variables, the admin screen shows them next to the rule, and the app fills them in.
 */

export type VariableType = 'number' | 'string' | 'bool';

export type RuleVariable = {
  name: string;
  type: VariableType;
  group: 'promoter_event' | 'event' | 'promoter';
  en: string;
  fr: string;
};

export const RULE_VARIABLES: readonly RuleVariable[] = [
  // This promoter, for this event
  { name: 'tickets_sold', type: 'number', group: 'promoter_event', en: 'Tickets paid and not cancelled, with their codes.', fr: 'Billets payés et non annulés, avec ses codes.' },
  { name: 'tickets_awaiting', type: 'number', group: 'promoter_event', en: 'Tickets waiting for an offline payment.', fr: 'Billets en attente d’un paiement hors ligne.' },
  { name: 'orders', type: 'number', group: 'promoter_event', en: 'Completed orders with their codes.', fr: 'Commandes complétées avec ses codes.' },
  { name: 'full_price_sales', type: 'number', group: 'promoter_event', en: 'Sales at full price, before the code’s discount, without taxes and fees, in dollars.', fr: 'Ventes au plein prix, avant le rabais du code, sans taxes ni frais, en dollars.' },
  { name: 'paid_by_customers', type: 'number', group: 'promoter_event', en: 'What customers actually paid, in dollars.', fr: 'Ce que les clients ont réellement payé, en dollars.' },
  { name: 'codes_used', type: 'number', group: 'promoter_event', en: 'How many of their codes sold at least once.', fr: 'Nombre de ses codes qui ont vendu au moins une fois.' },
  { name: 'outside_tickets', type: 'number', group: 'promoter_event', en: 'Tickets sold outside Hi.Events, entered by an admin for this event.', fr: 'Billets vendus hors Hi.Events, entrés par un admin pour cet événement.' },
  { name: 'outside_sales', type: 'number', group: 'promoter_event', en: 'Sales outside Hi.Events entered by an admin for this event, in dollars.', fr: 'Ventes hors Hi.Events entrées par un admin pour cet événement, en dollars.' },
  // The event
  { name: 'event_tickets_sold', type: 'number', group: 'event', en: 'All tickets sold for the event, by everyone.', fr: 'Tous les billets vendus pour l’événement, par tout le monde.' },
  { name: 'event_promoters', type: 'number', group: 'event', en: 'Promoters who sold at least one ticket for the event.', fr: 'Promoteurs ayant vendu au moins un billet pour l’événement.' },
  { name: 'days_before_event', type: 'number', group: 'event', en: 'Days until the event (negative once it started).', fr: 'Jours d’ici l’événement (négatif une fois commencé).' },
  { name: 'event_dates', type: 'number', group: 'event', en: 'How many dates the event has.', fr: 'Nombre de dates de l’événement.' },
  // The promoter in general
  { name: 'lifetime_tickets', type: 'number', group: 'promoter', en: 'Every ticket they sold, all events, outside sales included.', fr: 'Tous les billets qu’il a vendus, tous événements, ventes hors Hi.Events comprises.' },
  { name: 'events_promoted', type: 'number', group: 'promoter', en: 'Events where they sold at least one ticket.', fr: 'Événements où il a vendu au moins un billet.' },
  { name: 'level', type: 'string', group: 'promoter', en: 'Their level’s name, like "Gold".', fr: 'Le nom de son niveau, ex. "Gold".' },
  { name: 'is_team_lead', type: 'bool', group: 'promoter', en: 'True for a team lead.', fr: 'Vrai pour un chef d’équipe.' },
  { name: 'team_size', type: 'number', group: 'promoter', en: 'Promoters on their team (0 when not a team lead).', fr: 'Promoteurs dans son équipe (0 s’il n’est pas chef d’équipe).' },
  { name: 'team_full_price_sales', type: 'number', group: 'promoter', en: 'Sales at full price by their team for this event, theirs included, in dollars.', fr: 'Ventes au plein prix de son équipe pour cet événement, les siennes comprises, en dollars.' },
  { name: 'team_tickets_sold', type: 'number', group: 'promoter', en: 'Tickets sold by their team for this event, theirs included.', fr: 'Billets vendus par son équipe pour cet événement, les siens compris.' },
];

export type RuleInputs = Record<string, number | string | boolean>;

/** Fixed outputs. Any other name a rule gives must be one of the reward types (VIP, GA list…). */
export const FIXED_OUTPUTS = [
  { name: 'commission', en: 'Commission, in dollars.', fr: 'Commission, en dollars.' },
  { name: 'bonus', en: 'A one-time bonus, in dollars, kept apart from the commission.', fr: 'Un bonus ponctuel, en dollars, gardé à part de la commission.' },
  { name: 'merch', en: 'Merch items.', fr: 'Articles de merch.' },
] as const;

/** Inputs with every variable at its "nothing sold" value: a start for tests and previews. */
export function emptyInputs(): RuleInputs {
  return Object.fromEntries(RULE_VARIABLES.map((v) => [v.name, v.type === 'number' ? 0 : v.type === 'bool' ? false : '']));
}
