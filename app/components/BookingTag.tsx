import React from 'react';
import { BOOKING_LABEL, BOOK_AHEAD_KINDS, type BookingKind } from '@/lib/booking';

const TONE: Record<BookingKind, string> = {
  walk_in: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  reservation_recommended: 'border-amber-200 bg-amber-50 text-amber-900',
  reservation_required: 'border-orange-200 bg-orange-50 text-orange-900',
  hard_to_book: 'border-rose-200 bg-rose-50 text-rose-900',
  tickets_required: 'border-violet-200 bg-violet-50 text-violet-900',
  no_reservations: 'border-slate-200 bg-slate-50 text-slate-700',
  unknown: 'border-slate-200 bg-white text-slate-500',
};

export default function BookingTag({
  booking,
  note,
}: {
  booking?: BookingKind;
  note?: string;
}) {
  if (!booking) return null;
  const needsBook = BOOK_AHEAD_KINDS.has(booking);
  return (
    <span
      className={`mt-2 inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[booking]}`}
      title={note || undefined}
    >
      {needsBook ? 'Book ahead · ' : ''}
      {BOOKING_LABEL[booking]}
      {note ? <span className="ml-1 font-normal opacity-80">· {note}</span> : null}
    </span>
  );
}
