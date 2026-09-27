"use client";
import { useEffect } from "react";
import { markNotificationsReadAction } from "@/app/(app)/actions";

/** Marks what's on screen as read after a short moment, so the badge clears. */
export function MarkRead({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => void markNotificationsReadAction(key.split(",")), 1200);
    return () => clearTimeout(t);
  }, [key]);
  return null;
}
