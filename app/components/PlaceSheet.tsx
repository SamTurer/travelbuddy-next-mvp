'use client';

import BookingTag from '@/app/components/BookingTag';
import DayMap from '@/app/components/DayMap';
import MapsLink from '@/app/components/MapsLink';
import RecommendedBy from '@/app/components/RecommendedBy';
import UnderstoodMatch from '@/app/components/UnderstoodMatch';
import type { BookingKind } from '@/lib/booking';
import type { RecommendedByPerson } from '@/lib/recommenders';

export type PlaceView = {
  title: string;
  time?: string;
  location?: string;
  address?: string | null;
  description?: string;
  note?: string;
  url?: string;
  lat?: number;
  lng?: number;
  booking?: BookingKind;
  bookingNote?: string;
  bookingUrl?: string;
  recommendedBy?: RecommendedByPerson[];
  understood?: { title: string; neighborhood: string };
  mustDo?: boolean;
};

export default function PlaceSheet({ place, onClose }: { place: PlaceView; onClose: () => void }) {
  const maps =
    place.url ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      place.address || `${place.title} ${place.location || ''} New York`
    )}`;
  const points =
    place.lat != null && place.lng != null ? [{ lat: place.lat, lng: place.lng, title: place.title }] : [];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-grouped" role="dialog" aria-label={place.title}>
      <div className="relative">
        {points.length ? (
          <DayMap points={points} height={220} />
        ) : (
          <div className="h-40 bg-[#E6E6E1]" />
        )}
        <button
          type="button"
          onClick={onClose}
          className="tap absolute left-4 top-[max(12px,env(safe-area-inset-top))] rounded-full bg-white/90 px-3 text-sm font-semibold text-system shadow"
        >
          Close
        </button>
      </div>
      <div className="relative -mt-5 flex-1 overflow-y-auto rounded-t-2xl bg-grouped px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 mt-2 h-1 w-9 rounded-full bg-[#C7C7CC]" />
        <div className="rounded-[14px] bg-white px-4 py-4">
          <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-ink">{place.title}</h1>
          {place.location ? <p className="mt-1 text-[15px] text-mute">{place.location}</p> : null}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <BookingTag booking={place.booking} />
            {place.mustDo ? (
              <span className="inline-flex rounded-md bg-[#007AFF14] px-1.5 py-0.5 text-[11px] font-medium text-system">
                Must-do
              </span>
            ) : null}
          </div>
          {place.understood ? (
            <div className="mt-2">
              <UnderstoodMatch
                title={place.understood.title}
                neighborhood={place.understood.neighborhood}
                time={place.time?.split('–')[0]?.trim()}
              />
            </div>
          ) : null}
          {place.recommendedBy?.length ? (
            <div className="mt-3.5 flex items-center gap-2.5 border-t border-black/10 pt-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                {place.recommendedBy
                  .map((person) => person.displayName[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <RecommendedBy people={place.recommendedBy} />
            </div>
          ) : null}
        </div>
        <div className="mt-2 overflow-hidden rounded-[14px] bg-white">
          {place.time ? <Row label="Time" value={place.time} /> : null}
          {place.address ? <Row label="Address" value={place.address} /> : null}
          {place.location ? <Row label="Area" value={place.location} /> : null}
        </div>
        {place.note ? <p className="mt-2 rounded-[14px] bg-white px-4 py-3 text-[15px] leading-snug text-[#3A3A3C]">{place.note}</p> : null}
        {place.description ? (
          <p className="mt-2 rounded-[14px] bg-white px-4 py-3 text-[15px] leading-snug text-[#3A3A3C]">{place.description}</p>
        ) : null}
        {place.bookingNote ? <p className="mt-2 px-1 text-xs text-mute">{place.bookingNote}</p> : null}
        <div className="mt-2.5 flex gap-2">
          {place.bookingUrl ? (
            <a
              href={place.bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="tap flex flex-1 items-center justify-center rounded-xl bg-system text-base font-semibold text-white"
            >
              Get tickets
            </a>
          ) : null}
          <MapsLink
            href={maps}
            className={`tap flex flex-1 items-center justify-center rounded-xl text-base font-semibold ${
              place.bookingUrl ? 'bg-[#78788014] text-system' : 'bg-system text-white'
            }`}
          >
            Open in Google Maps
          </MapsLink>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[#C6C6C8]/80 px-4 py-2.5 first:border-t-0">
      <span className="w-24 shrink-0 pt-0.5 text-[13px] text-mute">{label}</span>
      <span className="text-right text-[15px] text-ink">{value}</span>
    </div>
  );
}
