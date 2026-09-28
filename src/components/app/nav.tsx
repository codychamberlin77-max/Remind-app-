"use client";
import { Bell, FolderOpen, Home, Plus, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav({ name, unread = 0 }: { name: string; unread?: number }) {
  const path = usePathname();
  return (
    <>
      <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-md border-b border-line">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Logo href="/home" />
          <nav className="hidden sm:flex items-center gap-0.5">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "px-3 h-8 inline-flex items-center rounded-lg text-[13.5px] transition-colors",
                  path.startsWith(l.href) ? "text-ink bg-hover font-medium" : "text-muted hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/notifications"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              className={cn("relative grid place-items-center size-9 rounded-full press", path.startsWith("/notifications") ? "bg-hover" : "hover:bg-hover")}
            >
              <Bell className="size-[18px]" />
              {unread ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-coral text-ink text-[10.5px] font-bold tabular">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>
            <Button asChild size="sm">
              <Link href="/add">
                <Plus className="size-3.5" /> Add
              </Link>
            </Button>
            <span className="hidden sm:grid size-8 place-items-center rounded-full bg-hover text-[12px] font-semibold text-ink-2" title={name}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </div>
      </header>
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 h-16">
          {LINKS.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={cn("flex flex-col items-center justify-center gap-1 text-[11px]", active ? "text-ink" : "text-subtle")}>
                <l.icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
