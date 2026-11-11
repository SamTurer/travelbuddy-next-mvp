'use client';

export type MapPoint = {
  lat: number;
  lng: number;
  title: string;
  mode?: 'walk' | 'transit' | string | null;
};

/**
 * Stylized day map from coordinates. No tile server and no API key,
 * so it still draws when the phone is offline.
 */
export default function DayMap({ points, height = 196 }: { points: MapPoint[]; height?: number }) {
  const plotted = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!plotted.length) return null;

  const lats = plotted.map((point) => point.lat);
  const lngs = plotted.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(maxLat - minLat, 0.008);
  const lngSpan = Math.max(maxLng - minLng, 0.008);
  const width = 390;
  const padX = 36;
  const padY = 28;
  const xy = plotted.map((point) => ({
    ...point,
    x: plotted.length === 1 ? width / 2 : padX + ((point.lng - minLng) / lngSpan) * (width - padX * 2),
    y: plotted.length === 1 ? height * 0.58 : padY + (1 - (point.lat - minLat) / latSpan) * (height - padY * 2),
  }));

  return (
    <div className="relative overflow-hidden bg-[#E6E6E1]" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Map of today's stops">
        <rect width={width} height={height} fill="#E6E6E1" />
        <rect x="0" y="0" width="118" height={height} fill="#C9D9C4" />
        <ellipse cx="48" cy={height * 0.32} rx="28" ry="16" fill="#B7CDB0" />
        <ellipse cx="78" cy={height * 0.62} rx="32" ry="18" fill="#AEC7A8" />
        <g stroke="#F7F7F4" strokeWidth="7" fill="none">
          {[150, 210, 270, 330].map((x) => (
            <path key={`v-${x}`} d={`M${x} 0v${height}`} />
          ))}
          {[0.28, 0.48, 0.68, 0.86].map((ratio) => (
            <path key={`h-${ratio}`} d={`M118 ${height * ratio}h${width}`} />
          ))}
        </g>
        {xy.slice(1).map((point, index) => (
          <path
            key={`leg-${index}`}
            d={`M${xy[index].x.toFixed(1)} ${xy[index].y.toFixed(1)} L${point.x.toFixed(1)} ${point.y.toFixed(1)}`}
            fill="none"
            stroke={point.mode === 'walk' ? '#34C759' : '#007AFF'}
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeDasharray={point.mode === 'walk' ? '5 5' : undefined}
          />
        ))}
        {xy.map((point, index) => (
          <g key={`${point.title}-${index}`} transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}>
            <path
              d="M0 0C0 0-8.2-9.2-8.2-16.2a8.2 8.2 0 1 1 16.4 0C8.2-9.2 0 0 0 0Z"
              fill={index === xy.length - 1 && xy.length > 1 ? '#007AFF' : '#1C1C1E'}
            />
            <circle cx="0" cy="-16.2" r="3.3" fill="#fff" />
          </g>
        ))}
      </svg>
    </div>
  );
}
