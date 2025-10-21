// lib/providers/distance.ts
// Lightweight wrapper around Google Distance Matrix API so we can retrieve
// accurate walking/transit durations between two NYC locations. These helpers
// are optional – they no-op if GOOGLE_MAPS_API_KEY is not configured.

type TravelMode = "walking" | "transit";

const DISTANCE_KEY = process.env.GOOGLE_MAPS_API_KEY;

type MatrixElement = {
  status: string;
  duration?: { value: number; text: string };
};

const cache = new Map<string, number | null>();

function cacheKey(origin: string, destination: string, mode: TravelMode, departure?: number) {
  const dep = departure ? `@${departure}` : "";
  return `${mode}:${origin}→${destination}${dep}`.toLowerCase();
}

async function fetchDistanceMinutes(
  origin: string,
  destination: string,
  mode: TravelMode,
  opts?: { departureTime?: number }
): Promise<number | null> {
  if (!DISTANCE_KEY) return null;
  const key = cacheKey(origin, destination, mode, opts?.departureTime);
  if (cache.has(key)) return cache.get(key) ?? null;

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("mode", mode);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("region", "us");
  url.searchParams.set("key", DISTANCE_KEY);
  if (mode === "transit" && opts?.departureTime) {
    url.searchParams.set("departure_time", String(opts.departureTime));
  }

  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data: any = await res.json();
    const element: MatrixElement | undefined = data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK" || !element.duration) {
      cache.set(key, null);
      return null;
    }
    const minutes = Math.max(0, Math.round(element.duration.value / 60));
    cache.set(key, minutes);
    return minutes;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export async function getTravelDurationsFromMaps(
  origin: string,
  destination: string,
  opts?: { departureTime?: number }
): Promise<{ walking?: number; transit?: number } | null> {
  if (!DISTANCE_KEY) return null;

  const [walking, transit] = await Promise.all([
    fetchDistanceMinutes(origin, destination, "walking", opts),
    fetchDistanceMinutes(origin, destination, "transit", opts)
  ]);

  if (walking == null && transit == null) return null;
  const result: { walking?: number; transit?: number } = {};
  if (walking != null) result.walking = walking;
  if (transit != null) result.transit = transit;
  return result;
}
