/**
 * How to get a lost receipt back, for stores that commonly allow it.
 * Worded as "usually" on purpose: store practices vary by location and change.
 */
const TIPS: [RegExp, string][] = [
  [/\bamazon\b/i, "Amazon keeps every order under Your Orders, where you can print an invoice."],
  [/\btarget\b/i, "Target can usually find in-store purchases from the card you paid with, and online orders are under Purchases in your Target account."],
  [/\bwal-?mart\b/i, "Walmart can usually look up a purchase from the card you paid with, and online orders are under Purchase History in the Walmart app."],
  [/\bbest\s*buy\b/i, "Best Buy can usually look up purchases from your card or My Best Buy account, and online orders are in your order history."],
  [/\bhome\s*depot\b/i, "Home Depot can usually look up a receipt online or in store from the card you paid with."],
  [/\blowe'?s\b/i, "Lowe's can usually find purchases made with a MyLowe's account or the card you paid with."],
  [/\bcostco\b/i, "Costco keeps warehouse and online purchases in the Orders & Purchases section of your membership account."],
  [/\bapple\b/i, "Apple Store purchases appear in your Apple Account order history, and many can be found with the card you paid with."],
  [/\bikea\b/i, "IKEA Family members can usually find purchases in their account; stores can sometimes look one up from your card."],
];

export function receiptRecoveryTip(merchant: string | null | undefined): string {
  const hit = merchant ? TIPS.find(([re]) => re.test(merchant)) : undefined;
  return (
    hit?.[1] ??
    "Many stores can find a purchase from the card you paid with or your account's order history. Check your email for an order confirmation, too — forward it here and we'll read it."
  );
}
