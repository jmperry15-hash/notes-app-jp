import { useId } from 'react';

/** The Folio notepad mark (same artwork as the home-screen icon). */
export function AppIcon({ size = 72, rounded = true }: { size?: number; rounded?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" className="drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#182c55" />
          <stop offset="1" stopColor="#0a1222" />
        </linearGradient>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3ca70" />
          <stop offset="1" stopColor="#d69c36" />
        </linearGradient>
        <linearGradient id={`${id}ring`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe7b8" />
          <stop offset="1" stopColor="#e0b25a" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx={rounded ? 228 : 0} fill={`url(#${id}bg)`} />
      <path
        d="M336 252 H688 A44 44 0 0 1 732 296 V682 L622 792 H336 A44 44 0 0 1 292 748 V296 A44 44 0 0 1 336 252 Z"
        fill={`url(#${id}gold)`}
      />
      <path d="M622 792 V716 A34 34 0 0 1 656 682 H732 Z" fill="#b5802a" />
      {[404, 484, 564].map((y) => (
        <rect key={y} x="362" y={y} width="300" height="34" rx="17" fill="#0e1a33" opacity="0.92" />
      ))}
      <rect x="362" y="644" width="180" height="34" rx="17" fill="#0e1a33" opacity="0.92" />
      {[377, 467, 557, 647].map((x) => (
        <g key={x}>
          <circle cx={x} cy="306" r="17" fill="#0e1a33" />
          <rect x={x - 14} y="206" width="28" height="104" rx="14" fill={`url(#${id}ring)`} />
        </g>
      ))}
    </svg>
  );
}
