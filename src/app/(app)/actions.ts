"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { REMINDER_PRESETS } from "@/server/domain/types";
import { deleteAccount, deleteAllData } from "@/server/services/account";
import { deleteDocument, NotFoundError } from "@/server/services/documents";
import {
  clearDuplicate,
  confirmFact,
  deleteItem,
  editFact,
  InputError,
  markItemReviewed,
  recordOutcome,
  setActionStatus,
  setItemState,
} from "@/server/services/items";
import { cancelReminder, createReminder, ReminderInputError, updatePreferences } from "@/server/services/reminders";
import { updateProfile } from "@/server/services/account";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const uuid = z.string().uuid();

async function run(fn: (userId: string) => Promise<string | void>, paths: string[] = ["/home"]): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const message = await fn(user.id);
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: message || undefined };
  } catch (e) {
    if (e instanceof InputError || e instanceof ReminderInputError) return { ok: false, error: e.message };
    if (e instanceof NotFoundError) return { ok: false, error: "That item no longer exists." };
    if (e instanceof z.ZodError) return { ok: false, error: "Invalid input." };
    console.error("[action]", (e as Error).message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function setReminderAction(input: { actionId: string; preset: string; customDate?: string | null; itemId?: string }) {
  const p = z.object({ actionId: uuid, preset: z.enum(REMINDER_PRESETS), customDate: z.string().nullable().optional() }).parse(input);
  return run(async (userId) => {
    const r = await createReminder(userId, p);
    return `Reminder set for ${r.remindAt.toLocaleString("en-US", { month: "short", day: "numeric" })}.`;
  }, ["/home", input.itemId ? `/items/${input.itemId}` : "/home", "/settings"]);
}

export async function cancelReminderAction(reminderId: string, itemId?: string) {
  uuid.parse(reminderId);
  return run((userId) => cancelReminder(userId, reminderId), ["/home", itemId ? `/items/${itemId}` : "/home", "/settings"]);
}

export async function editFactAction(input: { itemId: string; key: string; valueDate?: string; valueCents?: number; valueText?: string }) {
  const p = z
    .object({ itemId: uuid, key: z.string().regex(/^[a-z0-9_]{2,40}$/), valueDate: z.string().optional(), valueCents: z.number().int().optional(), valueText: z.string().max(200).optional() })
    .parse(input);
  return run((userId) => editFact(userId, p.itemId, p.key, p), ["/home", `/items/${p.itemId}`]);
}

export async function confirmFactAction(itemId: string, key: string) {
  uuid.parse(itemId);
  return run((userId) => confirmFact(userId, itemId, key), ["/home", `/items/${itemId}`]);
}

export async function markReviewedAction(itemId: string) {
  uuid.parse(itemId);
  return run((userId) => markItemReviewed(userId, itemId), ["/home", `/items/${itemId}`]);
}

export async function actionStatusAction(actionId: string, status: "open" | "done" | "dismissed" | "snoozed", itemId?: string) {
  uuid.parse(actionId);
  z.enum(["open", "done", "dismissed", "snoozed"]).parse(status);
  return run((userId) => setActionStatus(userId, actionId, status, { snoozeDays: 3 }), ["/home", itemId ? `/items/${itemId}` : "/home"]);
}

export async function itemStateAction(itemId: string, state: "active" | "saved" | "archived" | "dismissed") {
  uuid.parse(itemId);
  z.enum(["active", "saved", "archived", "dismissed"]).parse(state);
  return run((userId) => setItemState(userId, itemId, state), ["/home", `/items/${itemId}`]);
}

export async function clearDuplicateAction(itemId: string) {
  uuid.parse(itemId);
  return run((userId) => clearDuplicate(userId, itemId), ["/home", `/items/${itemId}`]);
}

export async function recordOutcomeAction(input: { itemId: string; kind: string; amountCents: number; note?: string }) {
  const p = z
    .object({
      itemId: uuid,
      kind: z.enum(["return_completed", "refund_received", "credit_used", "warranty_claim_paid", "cancelled_before_charge", "other"]),
      amountCents: z.number().int(),
      note: z.string().max(280).optional(),
    })
    .parse(input);
  return run((userId) => recordOutcome(userId, p), ["/home", `/items/${p.itemId}`]);
}

export async function deleteItemAction(itemId: string) {
  uuid.parse(itemId);
  const res = await run((userId) => deleteItem(userId, itemId));
  if (res.ok) redirect("/home");
  return res;
}

export async function deleteDocumentAction(documentId: string, redirectTo?: string) {
  uuid.parse(documentId);
  const res = await run((userId) => deleteDocument(userId, documentId), ["/home", "/documents"]);
  if (res.ok && redirectTo) redirect(redirectTo);
  return res;
}

export async function updatePreferencesAction(input: { emailEnabled?: boolean; inAppEnabled?: boolean; deliveryHour?: number }) {
  const p = z.object({ emailEnabled: z.boolean().optional(), inAppEnabled: z.boolean().optional(), deliveryHour: z.number().int().min(0).max(23).optional() }).parse(input);
  return run((userId) => updatePreferences(userId, p), ["/settings"]);
}

export async function updateProfileAction(input: { name?: string; timezone?: string }) {
  const p = z.object({ name: z.string().min(1).max(80).optional(), timezone: z.string().max(64).optional() }).parse(input);
  return run((userId) => updateProfile(userId, p), ["/settings", "/home"]);
}

export async function deleteAllDataAction(confirm: string) {
  if (confirm !== "DELETE") return { ok: false, error: "Type DELETE to confirm." } as ActionResult;
  return run((userId) => deleteAllData(userId), ["/home", "/documents", "/settings"]);
}

export async function deleteAccountAction(confirm: string) {
  if (confirm !== "DELETE") return { ok: false, error: "Type DELETE to confirm." } as ActionResult;
  const res = await run((userId) => deleteAccount(userId));
  if (res.ok) redirect("/?deleted=1");
  return res;
}
