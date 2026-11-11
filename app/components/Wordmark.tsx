export default function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M7 1.2c2.2 0 4 1.76 4 4.05 0 2.7-3.2 6.7-3.86 7.48a.2.2 0 0 1-.28 0C6.2 11.95 3 7.95 3 5.25 3 2.96 4.8 1.2 7 1.2Z"
            fill="#fff"
          />
          <circle cx="7" cy="5.1" r="1.45" fill="#1C1C1E" />
        </svg>
      </span>
      <span className="font-serif text-[17px] font-semibold tracking-tight text-ink">Travel Buddy</span>
    </div>
  );
}
