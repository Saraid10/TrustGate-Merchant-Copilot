/** TrustGate mark: a shield split by a gate line, with the proposal passing through. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M16 2.5 27 6.6v8.2c0 7-4.6 12.3-11 14.7C9.6 27.1 5 21.8 5 14.8V6.6L16 2.5Z"
        fill="var(--tg-navy)"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="1.6"
      />
      <path d="M16 7v18" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" strokeDasharray="2 2.2" />
      <circle cx="11" cy="15.5" r="2.6" fill="var(--tg-cyan)" />
      <path d="m18.6 15.6 2.2 2.2 4-4.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
