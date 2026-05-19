/**
 * OSSMeet brand mark — a geometric unicorn-tree hybrid.
 *
 * The form is a faceted crystal tree / low-poly pine rising from a
 * rounded base, with a single spiral horn (the unicorn) shooting up
 * from the crown.  Three small "leaf spark" diamonds float around it
 * to suggest magic / growth.
 */
export function BrandMark(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      {/* ── Spiral horn (unicorn) ── */}
      <path
        d="M16 2 L17.2 6 L16 5.2 L14.8 6 Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M14.8 6 L16 5.2 L17.2 6 L16.7 7.8 L16 7.2 L15.3 7.8 Z"
        fill="currentColor"
        opacity="0.8"
      />
      <path
        d="M15.3 7.8 L16 7.2 L16.7 7.8 L16.2 9.2 L16 8.8 L15.8 9.2 Z"
        fill="currentColor"
        opacity="0.65"
      />

      {/* ── Crown / upper canopy (faceted crystal) ── */}
      <polygon points="12,10 16,8.8 20,10 18.5,13 16,12 13.5,13" fill="currentColor" opacity="0.9" />
      <polygon points="16,12 18.5,13 17.5,15 16,14.2" fill="currentColor" opacity="0.7" />
      <polygon points="16,12 13.5,13 14.5,15 16,14.2" fill="currentColor" opacity="0.55" />

      {/* ── Mid canopy ── */}
      <polygon points="10.5,14 16,12.5 21.5,14 19.8,17.5 16,16 12.2,17.5" fill="currentColor" opacity="0.85" />
      <polygon points="16,16 19.8,17.5 18.5,20 16,18.8" fill="currentColor" opacity="0.6" />
      <polygon points="16,16 12.2,17.5 13.5,20 16,18.8" fill="currentColor" opacity="0.5" />

      {/* ── Lower canopy / widest layer ── */}
      <polygon points="9,19 16,17 23,19 21,22.5 16,21 11,22.5" fill="currentColor" opacity="0.75" />
      <polygon points="16,21 21,22.5 19.5,25 16,23.8" fill="currentColor" opacity="0.55" />
      <polygon points="16,21 11,22.5 12.5,25 16,23.8" fill="currentColor" opacity="0.45" />

      {/* ── Trunk / base ── */}
      <rect x="14.2" y="24" width="3.6" height="4" rx="0.6" fill="currentColor" opacity="0.7" />

      {/* ── Ground line ── */}
      <rect x="11" y="28" width="10" height="1.2" rx="0.6" fill="currentColor" opacity="0.3" />

      {/* ── Sparkle diamonds ── */}
      <path d="M7 8 L7.6 6.5 L8.5 6 L7.6 5.5 L7 4 L6.4 5.5 L5.5 6 L6.4 6.5 Z" fill="currentColor" opacity="0.5">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite" />
      </path>
      <path d="M25 12 L25.5 10.8 L26.3 10.3 L25.5 9.8 L25 8.5 L24.5 9.8 L23.7 10.3 L24.5 10.8 Z" fill="currentColor" opacity="0.4">
        <animate attributeName="opacity" values="0.2;0.6;0.2" dur="4s" repeatCount="indefinite" />
      </path>
      <path d="M24 22 L24.4 21 L25 20.6 L24.4 20.2 L24 19 L23.6 20.2 L23 20.6 L23.6 21 Z" fill="currentColor" opacity="0.35">
        <animate attributeName="opacity" values="0.15;0.5;0.15" dur="3.5s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
