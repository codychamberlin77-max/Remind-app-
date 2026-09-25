"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode, googleEnabled }: { mode: "sign-in" | "sign-up"; googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signUp = mode === "sign-up";
  const next = signUp ? "/welcome" : "/home";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    try {
      const res = signUp
        ? await authClient.signUp.email({
            email,
            password,
            name: String(fd.get("name") ?? "").trim() || email.split("@")[0]!,
            // Deadlines are calendar days; we need the user's timezone to get "today" right.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          } as Parameters<typeof authClient.signUp.email>[0])
        : await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{signUp ? "Let's find what you're forgetting." : "Welcome back."}</h1>
      <p className="text-muted mt-2 text-[15px]">{signUp ? "Create your account. It takes a few seconds." : "Sign in to see what needs your attention."}</p>

      {googleEnabled ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full mt-8"
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
          >
            <GoogleMark /> Continue with Google
          </Button>
          <div className="my-6 flex items-center gap-3 text-[12px] text-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : (
        <div className="h-8" />
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        {signUp ? (
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" placeholder="Your first name" />
          </div>
        ) : null}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={signUp ? 10 : undefined}
            autoComplete={signUp ? "new-password" : "current-password"}
            placeholder={signUp ? "At least 10 characters" : ""}
          />
        </div>
        {error ? <p role="alert" className="text-[13.5px] text-urgent">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "One moment…" : signUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-[14px] text-muted text-center">
        {signUp ? (
          <>Already have an account? <Link href="/sign-in" className="text-ink font-medium">Sign in</Link></>
        ) : (
          <>New here? <Link href="/sign-up" className="text-ink font-medium">Create an account</Link></>
        )}
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1-3.8 1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.7 14a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9L5.7 14z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}
