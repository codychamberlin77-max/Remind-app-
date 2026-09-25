import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="h-16 px-5 flex items-center">
        <Logo />
      </header>
      <main className="flex-1 grid place-items-center px-5 pb-16">
        <div className="w-full max-w-[380px] animate-rise">{children}</div>
      </main>
    </div>
  );
}
