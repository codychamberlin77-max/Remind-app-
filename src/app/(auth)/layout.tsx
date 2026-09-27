import { Coin, CreditBuddy, Heart, ReceiptBuddy, ShieldBuddy, Sparkle, Star, TrialBuddy } from "@/components/brand/stickers";
import { Logo } from "@/components/ui/logo";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col">
        <header className="h-[72px] px-5 sm:px-8 flex items-center">
          <Logo />
        </header>
        <main className="flex-1 grid place-items-center px-5 pb-16">
          <div className="w-full max-w-[380px] animate-rise">
            <div aria-hidden className="lg:hidden flex items-end gap-1 mb-8 h-20">
              <ReceiptBuddy className="w-14 animate-pop [--tilt:-8deg]" />
              <TrialBuddy className="w-14 animate-pop [animation-delay:120ms]" />
              <CreditBuddy className="w-[70px] animate-pop [animation-delay:200ms] [--tilt:6deg]" />
            </div>
            {children}
          </div>
        </main>
      </div>
      <aside aria-hidden className="hidden lg:block relative m-3 rounded-[32px] bg-sun overflow-hidden">
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative w-[420px] h-[420px]">
            <div className="absolute inset-10 rounded-full bg-white/35" />
            <ReceiptBuddy className="absolute left-[8%] top-[8%] w-36 animate-float [--tilt:-8deg]" />
            <CreditBuddy className="absolute right-[2%] top-[30%] w-40 animate-float-slow [--tilt:6deg] [animation-delay:-2s]" />
            <ShieldBuddy className="absolute left-[24%] bottom-[2%] w-32 animate-float [animation-delay:-3s]" />
            <Coin className="absolute right-[18%] top-[4%] w-14 animate-float-slow" />
            <Heart className="absolute left-[2%] bottom-[30%] w-11 animate-float [animation-delay:-1s]" />
            <Star className="absolute right-[10%] bottom-[12%] w-10 animate-float-slow [animation-delay:-4s]" />
            <Sparkle className="absolute left-[46%] top-[40%] w-7 animate-float" color="var(--color-coral)" />
          </div>
        </div>
        <p className="absolute left-10 right-10 bottom-10 display-2 text-ink text-[40px]">Stop losing money to fine print.</p>
      </aside>
    </div>
  );
}
