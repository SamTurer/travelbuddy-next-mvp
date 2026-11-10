import React from 'react';
import { BOOKING_LABEL, type BookingKind } from '@/lib/booking';

const TONE: Record<BookingKind, string> = {
  walk_in: 'bg-[#34C75918] text-[#248A3D]',
  reservation_recommended: 'bg-[#FF950014] text-[#C93400]',
  reservation_required: 'bg-[#FF950014] text-[#C93400]',
  hard_to_book: 'bg-[#FF950014] text-[#C93400]',
  tickets_required: 'bg-[#FF950014] text-[#C93400]',
  no_reservations: 'bg-[#78788014] text-[#636366]',
  unknown: 'bg-[#78788014] text-[#636366]',
};

export default function BookingTag({
  booking,
  note,
}: {
  booking?: BookingKind;
  note?: string;
}) {
  if (!booking) return null;
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-snug ${TONE[booking]}`}
      title={note || undefined}
    >
      {BOOKING_LABEL[booking]}
      {note ? <span className="ml-1 font-normal opacity-80">· {note}</span> : null}
    </span>
  );
}
