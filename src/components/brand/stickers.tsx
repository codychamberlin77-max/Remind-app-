import { cn } from "@/lib/cn";

/**
 * LIFEOS stickers: the things we keep track of, drawn as bold printed stickers
 * (ink outline + hard offset shadow, rosy cheeks, no limbs). Hand-drawn SVG,
 * no external assets. Only the eyes animate (a blink).
 */

const INK = "#141414";
const SW = 3.5; // outline width
const SHADOW = 5; // hard shadow offset

type StickerProps = { className?: string; style?: React.CSSProperties };

/** Draws `d` twice: an ink shadow offset down-right, then the filled, outlined shape. */
function Shape({ d, fill }: { d: string; fill: string }) {
  return (
    <>
      <path d={d} fill={INK} transform={`translate(${SHADOW} ${SHADOW})`} />
      <path d={d} fill={fill} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    </>
  );
}

function Face({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="-17" cy="7" rx="4.5" ry="2.8" fill="var(--color-pink)" opacity=".9" />
      <ellipse cx="17" cy="7" rx="4.5" ry="2.8" fill="var(--color-pink)" opacity=".9" />
      <g className="blink" style={{ animationDelay: `${-((x * 7 + y * 3) % 50) / 10}s` }}>
        <circle cx="-9" cy="0" r="3.8" fill={INK} />
        <circle cx="9" cy="0" r="3.8" fill={INK} />
        <circle cx="-7.8" cy="-1.3" r="1.2" fill="#fff" />
        <circle cx="10.2" cy="-1.3" r="1.2" fill="#fff" />
      </g>
      <path d="M-6 6 Q0 14 6 6 Z" fill={INK} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    </g>
  );
}

export function ReceiptBuddy({ className, style }: StickerProps) {
  const body = "M26 10 H94 A6 6 0 0 1 100 16 V112 l-8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6 V16 A6 6 0 0 1 26 10 Z";
  return (
    <svg viewBox="0 0 112 126" className={cn("w-28", className)} style={style} aria-hidden>
      <Shape d={body} fill="var(--color-blue)" />
      <path d="M36 74 H84 M36 86 H70 M36 98 H78" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity=".8" />
      <Face x={60} y={44} />
    </svg>
  );
}

export function TrialBuddy({ className, style }: StickerProps) {
  const body = "M32 24 H96 A18 18 0 0 1 114 42 V98 A18 18 0 0 1 96 116 H32 A18 18 0 0 1 14 98 V42 A18 18 0 0 1 32 24 Z";
  return (
    <svg viewBox="0 0 126 126" className={cn("w-28", className)} style={style} aria-hidden>
      <Shape d={body} fill="var(--color-grape)" />
      <path d="M32 24 H96 A18 18 0 0 1 114 42 V50 H14 V42 A18 18 0 0 1 32 24 Z" fill={INK} />
      <rect x="36" y="10" width="11" height="24" rx="5.5" fill="#fff" stroke={INK} strokeWidth={SW} />
      <rect x="81" y="10" width="11" height="24" rx="5.5" fill="#fff" stroke={INK} strokeWidth={SW} />
      <Face x={64} y={80} />
    </svg>
  );
}

export function CreditBuddy({ className, style }: StickerProps) {
  const body = "M16 22 A8 8 0 0 1 24 14 H126 A8 8 0 0 1 134 22 V40 A12 12 0 0 0 134 64 V82 A8 8 0 0 1 126 90 H24 A8 8 0 0 1 16 82 V64 A12 12 0 0 0 16 40 Z";
  return (
    <svg viewBox="0 0 146 102" className={cn("w-32", className)} style={style} aria-hidden>
      <Shape d={body} fill="var(--color-coral)" />
      <path d="M104 20 V84" stroke={INK} strokeWidth="3" strokeDasharray="5 6" strokeLinecap="round" />
      <path d="M113 42 l10 10 -10 10" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Face x={60} y={50} />
    </svg>
  );
}

export function ShieldBuddy({ className, style }: StickerProps) {
  const body = "M60 8 L102 22 V56 Q102 98 60 118 Q18 98 18 56 V22 Z";
  return (
    <svg viewBox="0 0 112 126" className={cn("w-28", className)} style={style} aria-hidden>
      <Shape d={body} fill="var(--color-leaf)" />
      <path d="M60 20 L90 30 V56 Q90 88 60 104" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
      <Face x={58} y={58} />
    </svg>
  );
}

export function Coin({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 64 64" className={cn("w-12", className)} style={style} aria-hidden>
      <circle cx="31" cy="31" r="24" fill={INK} transform="translate(4 4)" />
      <circle cx="31" cy="31" r="24" fill="var(--color-sun)" stroke={INK} strokeWidth={SW} />
      <circle cx="31" cy="31" r="16" fill="none" stroke={INK} strokeWidth="2" strokeDasharray="3 4" />
      <text x="31" y="39" textAnchor="middle" fontSize="22" fontWeight="800" fill={INK} fontFamily="var(--font-display)">$</text>
    </svg>
  );
}

export function Star({ className, style, color = "var(--color-sun)" }: StickerProps & { color?: string }) {
  const d = "M22 4 l5.5 11.5 12.5 1.7 -9 8.8 2.2 12.5 -11.2 -6 -11.2 6 2.2 -12.5 -9 -8.8 12.5 -1.7 z";
  return (
    <svg viewBox="0 0 48 48" className={cn("w-8", className)} style={style} aria-hidden>
      <path d={d} fill={INK} transform="translate(3 3)" />
      <path d={d} fill={color} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

export function Heart({ className, style }: StickerProps) {
  const d = "M24 42 C8 30 3 22 3 14 A10.5 10.5 0 0 1 24 9.5 A10.5 10.5 0 0 1 45 14 C45 22 40 30 24 42z";
  return (
    <svg viewBox="0 0 52 50" className={cn("w-10", className)} style={style} aria-hidden>
      <path d={d} fill={INK} transform="translate(3 3)" />
      <path d={d} fill="var(--color-pink)" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckBubble({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 62 62" className={cn("w-12", className)} style={style} aria-hidden>
      <circle cx="28" cy="28" r="24" fill={INK} transform="translate(4 4)" />
      <circle cx="28" cy="28" r="24" fill="#fff" stroke={INK} strokeWidth={SW} />
      <path d="M17 29 l7.5 7.5 15 -16" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sparkle({ className, style, color = "var(--color-blue)" }: StickerProps & { color?: string }) {
  const d = "M16 2 q2 12 14 14 q-12 2 -14 14 q-2 -12 -14 -14 q12 -2 14 -14z";
  return (
    <svg viewBox="0 0 34 34" className={cn("w-6", className)} style={style} aria-hidden>
      <path d={d} fill={color} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Dot({ className, color }: { className?: string; color: string }) {
  return <span aria-hidden className={cn("block rounded-full border-2 border-ink", className)} style={{ background: color }} />;
}

/** Kind → sticker + colors, shared by the landing page and the app. */
export const KIND_STYLE = {
  purchase: { label: "Returns", bg: "bg-blue", soft: "bg-blue-soft", text: "text-blue-ink", Sticker: ReceiptBuddy },
  subscription: { label: "Trials & renewals", bg: "bg-grape", soft: "bg-grape-soft", text: "text-grape-ink", Sticker: TrialBuddy },
  travel_credit: { label: "Travel credits", bg: "bg-coral", soft: "bg-coral-soft", text: "text-coral-ink", Sticker: CreditBuddy },
  warranty: { label: "Warranties", bg: "bg-leaf", soft: "bg-leaf-soft", text: "text-leaf-ink", Sticker: ShieldBuddy },
} as const;
