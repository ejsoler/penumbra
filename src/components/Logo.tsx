/** The app mark: a half-filled circle, same shape as build/icon.svg. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2.5 A9.5 9.5 0 0 0 12 21.5 Z" fill="currentColor" />
    </svg>
  );
}
