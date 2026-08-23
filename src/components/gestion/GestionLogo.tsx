// Shared Morada glyph + the space's own wordmark: the user must instantly
// read "I am in Morada Gestion" while recognising the ecosystem brand.
export default function GestionLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-auto" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="9" className="fill-brand-700" />
        <path
          d="M8 22.5V13.4c0-.5.24-.98.65-1.27l6.44-4.6a1.6 1.6 0 0 1 1.86 0l6.4 4.6c.4.3.65.77.65 1.27v9.1"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="17.4" r="2.1" className="fill-accent-500" />
      </svg>
      {!compact && (
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-xl font-bold tracking-tight text-brand-800">morada</span>
          <span className="font-display text-xl font-bold tracking-tight text-brand-500">gestion</span>
        </span>
      )}
    </span>
  );
}
