/** The app mark: two stacked cards on a moss tile. Colours follow the theme. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <rect
        x="6.5"
        y="10"
        width="15"
        height="17"
        rx="3"
        transform="rotate(-9 14 18.5)"
        className="fill-accent-foreground"
        opacity="0.45"
      />
      <rect x="10.5" y="6.5" width="15" height="17" rx="3" className="fill-accent-foreground" />
      <path
        d="M14 12.5h8M14 15.5h8M14 18.5h5"
        className="stroke-accent"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
