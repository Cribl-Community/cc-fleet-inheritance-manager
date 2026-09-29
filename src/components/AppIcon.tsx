/** Fleet Inheritance Manager logo: a parent fleet branching into two child packs. */
export function AppIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="app-icon-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1a73e8" />
          <stop offset="1" stopColor="#12a594" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#app-icon-bg)" />
      <g stroke="#ffffff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="11.5" y="5" width="9" height="6.5" rx="1.5" fill="#ffffff" fillOpacity="0.25" />
        <path d="M16 11.5v3.5M8 18v-3h16v3" />
        <rect x="4" y="18" width="8" height="8" rx="1.5" />
        <path d="M4 21h8M7 23h2" />
        <rect x="20" y="18" width="8" height="8" rx="1.5" />
        <path d="M20 21h8M23 23h2" />
      </g>
    </svg>
  );
}
