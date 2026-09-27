import { cn } from "@/lib/cn";

/**
 * Playful sticker characters (hand-drawn SVG, no external assets).
 * Each one is a thing LIFEOS keeps track of, with a face and little legs.
 */

const INK = "#1c1b1a";

function Face({ x, y, s = 1, mood = "happy" }: { x: number; y: number; s?: number; mood?: "happy" | "calm" | "wow" }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {mood === "calm" ? (
        <>
          <path d="M-12 -2 q4 4 8 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M4 -2 q4 4 8 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="-8" cy="-2" rx="3.2" ry="4.2" fill={INK} />
          <ellipse cx="8" cy="-2" rx="3.2" ry="4.2" fill={INK} />
        </>
      )}
      {mood === "wow" ? <ellipse cx="0" cy="9" rx="3.5" ry="4" fill={INK} /> : <path d="M-6 7 q6 6 12 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />}
    </g>
  );
}

function Legs({ x, y, gap = 22, color = "#ffc233" }: { x: number; y: number; gap?: number; color?: string }) {
  return (
    <g stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none">
      <path d={`M${x - gap / 2} ${y} l-3 16`} />
      <path d={`M${x + gap / 2} ${y} l4 15`} />
      <path d={`M${x - gap / 2 - 3} ${y + 16} l-7 1`} stroke={color} strokeWidth="6" />
      <path d={`M${x + gap / 2 + 4} ${y + 15} l7 0`} stroke={color} strokeWidth="6" />
    </g>
  );
}

type StickerProps = { className?: string; style?: React.CSSProperties };

export function ReceiptBuddy({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 120 140" className={cn("w-28", className)} style={style} aria-hidden>
      <Legs x={60} y={112} color="#ffc233" />
      <path d="M22 14 q0-8 8-8 h60 q8 0 8 8 v96 l-8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6z" fill="var(--color-blue)" />
      <rect x="36" y="64" width="48" height="5" rx="2.5" fill="#fff" opacity=".55" />
      <rect x="36" y="76" width="32" height="5" rx="2.5" fill="#fff" opacity=".55" />
      <rect x="36" y="88" width="40" height="5" rx="2.5" fill="#fff" opacity=".55" />
      <Face x={60} y={40} />
      <path d="M22 50 q-14 4 -16 18" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M98 48 q14 -6 18 -20" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function TrialBuddy({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 130 140" className={cn("w-28", className)} style={style} aria-hidden>
      <Legs x={65} y={110} color="var(--color-coral)" />
      <rect x="14" y="22" width="102" height="92" rx="24" fill="var(--color-grape)" />
      <rect x="14" y="22" width="102" height="26" rx="13" fill="#6d3fe0" />
      <rect x="38" y="10" width="9" height="24" rx="4.5" fill={INK} />
      <rect x="83" y="10" width="9" height="24" rx="4.5" fill={INK} />
      <Face x={65} y={78} mood="calm" />
      <circle cx="40" cy="92" r="6" fill="#fff" opacity=".25" />
      <circle cx="90" cy="92" r="6" fill="#fff" opacity=".25" />
    </svg>
  );
}

export function CreditBuddy({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 150 120" className={cn("w-32", className)} style={style} aria-hidden>
      <Legs x={75} y={92} color="var(--color-blue)" gap={30} />
      <path d="M12 26 q0-10 10-10 h106 q10 0 10 10 v16 a12 12 0 0 0 0 24 v16 q0 10 -10 10 h-106 q-10 0 -10 -10 v-16 a12 12 0 0 0 0 -24z" fill="var(--color-coral)" />
      <path d="M100 22 v68" stroke="#fff" strokeWidth="3" strokeDasharray="6 6" opacity=".6" />
      <path d="M112 44 l12 10 -12 10" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
      <Face x={56} y={54} mood="wow" />
    </svg>
  );
}

export function ShieldBuddy({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 120 140" className={cn("w-28", className)} style={style} aria-hidden>
      <Legs x={60} y={112} color="var(--color-grape)" />
      <path d="M60 8 l44 14 v34 q0 44 -44 64 q-44 -20 -44 -64 v-34z" fill="var(--color-leaf)" />
      <path d="M60 20 l32 10 v26 q0 34 -32 50z" fill="#fff" opacity=".18" />
      <Face x={60} y={58} />
      <path d="M16 60 q-12 -2 -14 -16" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M104 60 q12 0 14 14" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Coin({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 60 60" className={cn("w-12", className)} style={style} aria-hidden>
      <circle cx="30" cy="30" r="27" fill="#f5a700" />
      <circle cx="30" cy="28" r="25" fill="var(--color-sun)" />
      <path d="M14 38 L38 10 M22 44 L44 18" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

export function Star({ className, style, color = "var(--color-sun)" }: StickerProps & { color?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("w-8", className)} style={style} aria-hidden>
      <path d="M20 3 l5 11 12 1.5 -9 8 2.5 12 -10.5 -6 -10.5 6 2.5 -12 -9 -8 12 -1.5z" fill={color} strokeLinejoin="round" />
    </svg>
  );
}

export function Heart({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 48 44" className={cn("w-10", className)} style={style} aria-hidden>
      <path d="M24 42 C8 30 2 22 2 14 A11 11 0 0 1 24 9 A11 11 0 0 1 46 14 C46 22 40 30 24 42z" fill="var(--color-coral)" />
      <circle cx="34" cy="14" r="3.5" fill="#fff" opacity=".6" />
    </svg>
  );
}

export function CheckBubble({ className, style }: StickerProps) {
  return (
    <svg viewBox="0 0 56 56" className={cn("w-12", className)} style={style} aria-hidden>
      <circle cx="28" cy="28" r="26" fill="#efeee9" />
      <path d="M16 29 l8 8 16 -18" stroke="var(--color-leaf)" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sparkle({ className, style, color = "var(--color-blue)" }: StickerProps & { color?: string }) {
  return (
    <svg viewBox="0 0 30 30" className={cn("w-6", className)} style={style} aria-hidden>
      <path d="M15 1 q2 12 14 14 q-12 2 -14 14 q-2 -12 -14 -14 q12 -2 14 -14z" fill={color} />
    </svg>
  );
}

export function Dot({ className, color }: { className?: string; color: string }) {
  return <span aria-hidden className={cn("block rounded-full", className)} style={{ background: color }} />;
}

/** Kind → sticker + colors, shared by the landing page and the app. */
export const KIND_STYLE = {
  purchase: { label: "Returns", bg: "bg-blue", soft: "bg-blue-soft", text: "text-blue", Sticker: ReceiptBuddy },
  subscription: { label: "Trials & renewals", bg: "bg-grape", soft: "bg-grape-soft", text: "text-grape", Sticker: TrialBuddy },
  travel_credit: { label: "Travel credits", bg: "bg-coral", soft: "bg-coral-soft", text: "text-coral", Sticker: CreditBuddy },
  warranty: { label: "Warranties", bg: "bg-leaf", soft: "bg-leaf-soft", text: "text-leaf", Sticker: ShieldBuddy },
} as const;
