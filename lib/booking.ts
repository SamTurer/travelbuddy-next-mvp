export const BOOKING_KINDS = [
  'walk_in',
  'reservation_recommended',
  'reservation_required',
  'hard_to_book',
  'tickets_required',
  'no_reservations',
  'unknown',
] as const;

export type BookingKind = (typeof BOOKING_KINDS)[number];

export const BOOKING_LABEL: Record<BookingKind, string> = {
  walk_in: 'Walk-ins welcome',
  reservation_recommended: 'Reservation recommended',
  reservation_required: 'Reservation required',
  hard_to_book: 'Hard to book',
  tickets_required: 'Tickets required',
  no_reservations: 'No reservations',
  unknown: 'Booking unknown',
};

export const BOOK_AHEAD_KINDS = new Set<BookingKind>([
  'reservation_required',
  'hard_to_book',
  'tickets_required',
]);

export function isBookingKind(value: string): value is BookingKind {
  return (BOOKING_KINDS as readonly string[]).includes(value);
}
