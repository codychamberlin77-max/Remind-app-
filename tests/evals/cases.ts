/**
 * LIFEOS extraction evaluation dataset.
 *
 * Each case = a realistic document + the recorded model response the mock
 * provider replays + the EXPECTED final system output. Recordings are allowed
 * (and sometimes designed) to be wrong; expectations describe what the product
 * must show after verification. The same documents and expectations are used
 * for live-provider runs (`npm run eval -- --provider anthropic`).
 *
 * Fixed "today" for every case: 2026-09-25 (a Friday), America/New_York.
 */
import type { Certainty, ActionType, DocumentStatus, ItemKind } from "@/server/domain/types";

export const EVAL_TODAY = "2026-09-25";

export type FileSpec =
  | { kind: "pdf"; lines: string[] }
  | { kind: "txt"; text: string }
  | { kind: "eml"; text: string }
  | { kind: "png"; lines: string[]; style: "screenshot" }
  | { kind: "jpg"; lines: string[]; style: "crumpled" | "unreadable" }
  | { kind: "raw"; base64: string; ext: string };

export type ExpectedFact = { certainty: Certainty; valueDate?: string; valueCents?: number };

export type EvalCase = {
  id: string;
  covers: string;
  file: FileSpec;
  requires?: string[];
  recording?: { classify?: unknown; transcribe?: unknown; extract?: unknown };
  expected: {
    status: DocumentStatus;
    items: Array<{ kind: ItemKind; titleIncludes?: string; facts?: Record<string, ExpectedFact>; duplicate?: boolean; conflict?: boolean }>;
    /** The complete set of deadlines that may be shown for this document. Anything else is a false deadline. */
    deadlines: Array<{ type: ActionType; dueOn: string; certainty: Certainty }>;
  };
};

const f = (value: unknown, evidence: string | null, confidence = 0.95) => ({ value, evidence, confidence });
const none = { value: null, evidence: null, confidence: 0 };
const noMoney = { value: null, currency: null, evidence: null, confidence: 0 };
const usd = (value: number, evidence: string, confidence = 0.95) => ({ value, currency: "USD", evidence, confidence });
const noPolicy = { return_days: none, return_by_date: none, policy_text: none };
const noWarranty = { duration_months: none, provider: none, ends_on: none, covered_item: none };
const cls = (document_type: string, confidence = 0.95, is_actionable = true) => ({ document_type, confidence, is_actionable, reason: "eval" });

const BESTBUY_LINES = [
  "**BEST BUY",
  "Store #1047 Union Square",
  "",
  "Date: 09/20/2026   14:32",
  "Order: BBY01-806449213",
  "",
  'SAMSUNG 65" CLASS Q80D QLED 4K TV     1,299.99',
  "  SKU 6576345",
  "GEEK SQUAD 2-YEAR PROTECTION PLAN       179.99",
  '  Covers: SAMSUNG 65" CLASS Q80D',
  "",
  "SUBTOTAL                             1,479.98",
  "SALES TAX 8.875%                       131.35",
  "**TOTAL                                $1,611.33",
  "",
  "VISA ************4821",
];

const bestBuyExtraction = {
  orders: [
    {
      merchant: f("Best Buy", "BEST BUY", 0.99),
      purchase_date: f("2026-09-20", "Date: 09/20/2026", 0.97),
      order_number: f("BBY01-806449213", "Order: BBY01-806449213", 0.97),
      line_items: [
        { name: 'SAMSUNG 65" CLASS Q80D QLED 4K TV', quantity: 1, total_price: 1299.99, evidence: 'SAMSUNG 65" CLASS Q80D QLED 4K TV 1,299.99', confidence: 0.96 },
        { name: "GEEK SQUAD 2-YEAR PROTECTION PLAN", quantity: 1, total_price: 179.99, evidence: "GEEK SQUAD 2-YEAR PROTECTION PLAN 179.99", confidence: 0.96 },
      ],
      subtotal: usd(1479.98, "SUBTOTAL 1,479.98"),
      tax: usd(131.35, "SALES TAX 8.875% 131.35"),
      total: usd(1611.33, "TOTAL $1,611.33", 0.98),
      payment_last4: f("4821", "VISA ************4821"),
      return_policy: noPolicy,
      warranty: {
        duration_months: f(24, "GEEK SQUAD 2-YEAR PROTECTION PLAN", 0.9),
        provider: f("Geek Squad", "GEEK SQUAD 2-YEAR PROTECTION PLAN", 0.9),
        ends_on: none,
        covered_item: f('SAMSUNG 65" CLASS Q80D', 'Covers: SAMSUNG 65" CLASS Q80D', 0.9),
      },
    },
  ],
};

const TARGET_LINES = [
  "TARGET",
  "Brooklyn Atlantic Terminal",
  "09/18/2026 18:04",
  "",
  "APPLE AIRPODS PRO 2      249.99",
  "SUBTOTAL                 249.99",
  "TAX                       22.19",
  "TOTAL                    272.18",
  "",
  "RETURN BY 12/17/2026",
  "REDcard ****1188",
];

const SCREENSHOT_LINES = [
  "amazon",
  "Order placed September 18, 2026",
  "Order # 112-4839201-5550012",
  "",
  "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
  "$329.99",
  "Return or replace items: Eligible through October 18, 2026",
  "",
  "Item(s) Subtotal: $329.99",
  "Estimated tax to be collected: $26.40",
  "Order total: $356.39",
];

export const CASES: EvalCase[] = [
  {
    id: "clean_receipt",
    covers: "Clean receipt; no return policy printed; stated protection plan",
    file: { kind: "pdf", lines: BESTBUY_LINES },
    recording: { classify: cls("purchase_receipt", 0.98), extract: bestBuyExtraction },
    expected: {
      status: "processed",
      items: [
        {
          kind: "purchase",
          titleIncludes: "Samsung",
          facts: {
            total: { certainty: "confirmed", valueCents: 161133 },
            purchase_date: { certainty: "confirmed", valueDate: "2026-09-20" },
            return_deadline: { certainty: "estimated", valueDate: "2026-10-05" },
            warranty: { certainty: "confirmed", valueDate: "2028-09-20" },
          },
        },
      ],
      deadlines: [
        { type: "return", dueOn: "2026-10-05", certainty: "estimated" },
        { type: "warranty_expiring", dueOn: "2028-09-20", certainty: "confirmed" },
      ],
    },
  },
  {
    id: "crumpled_receipt_photo",
    covers: "Crumpled phone photo; partially legible; return-by printed",
    file: { kind: "jpg", lines: TARGET_LINES, style: "crumpled" },
    recording: {
      classify: cls("purchase_receipt", 0.9),
      transcribe: { text: TARGET_LINES.join("\n"), legibility: "partial" },
      extract: {
        orders: [
          {
            merchant: f("Target", "TARGET", 0.95),
            purchase_date: f("2026-09-18", "09/18/2026 18:04", 0.9),
            order_number: none,
            line_items: [{ name: "APPLE AIRPODS PRO 2", quantity: 1, total_price: 249.99, evidence: "APPLE AIRPODS PRO 2 249.99", confidence: 0.9 }],
            subtotal: usd(249.99, "SUBTOTAL 249.99", 0.9),
            tax: usd(22.19, "TAX 22.19", 0.85),
            total: usd(272.18, "TOTAL 272.18", 0.9),
            payment_last4: f("1188", "REDcard ****1188", 0.8),
            return_policy: { return_days: none, return_by_date: f("2026-12-17", "RETURN BY 12/17/2026", 0.9), policy_text: none },
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: {
      status: "needs_review",
      items: [
        {
          kind: "purchase",
          titleIncludes: "Airpods",
          facts: {
            purchase_date: { certainty: "estimated", valueDate: "2026-09-18" },
            return_deadline: { certainty: "estimated", valueDate: "2026-12-17" },
            warranty: { certainty: "estimated", valueDate: "2027-09-18" },
          },
        },
      ],
      deadlines: [
        { type: "return", dueOn: "2026-12-17", certainty: "estimated" },
        { type: "warranty_expiring", dueOn: "2027-09-18", certainty: "estimated" },
      ],
    },
  },
  {
    id: "screenshot_receipt",
    covers: "Screenshot of an online order with a stated return date",
    file: { kind: "png", lines: SCREENSHOT_LINES, style: "screenshot" },
    recording: {
      classify: cls("order_confirmation", 0.96),
      transcribe: { text: SCREENSHOT_LINES.join("\n"), legibility: "good" },
      extract: {
        orders: [
          {
            merchant: f("Amazon", "amazon", 0.95),
            purchase_date: f("2026-09-18", "Order placed September 18, 2026", 0.96),
            order_number: f("112-4839201-5550012", "Order # 112-4839201-5550012", 0.95),
            line_items: [{ name: "Sony WH-1000XM5 Wireless Noise Canceling Headphones", quantity: 1, total_price: 329.99, evidence: "$329.99", confidence: 0.9 }],
            subtotal: usd(329.99, "Item(s) Subtotal: $329.99"),
            tax: usd(26.4, "Estimated tax to be collected: $26.40"),
            total: usd(356.39, "Order total: $356.39", 0.97),
            payment_last4: none,
            return_policy: { return_days: none, return_by_date: f("2026-10-18", "Eligible through October 18, 2026", 0.95), policy_text: f("Return or replace items: Eligible through October 18, 2026", "Return or replace items: Eligible through October 18, 2026", 0.9) },
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: {
      status: "processed",
      items: [
        {
          kind: "purchase",
          titleIncludes: "Sony",
          facts: {
            total: { certainty: "confirmed", valueCents: 35639 },
            return_deadline: { certainty: "confirmed", valueDate: "2026-10-18" },
            warranty: { certainty: "estimated", valueDate: "2027-09-18" },
          },
        },
      ],
      deadlines: [
        { type: "return", dueOn: "2026-10-18", certainty: "confirmed" },
        { type: "warranty_expiring", dueOn: "2027-09-18", certainty: "estimated" },
      ],
    },
  },
  {
    id: "subscription_trial",
    covers: "Subscription renewal email; weekday-only trial end",
    file: {
      kind: "eml",
      text: [
        "From: Cadence Music <billing@cadence.example>",
        "To: someone@example.com",
        "Subject: Your free trial ends Sunday",
        "Date: Wed, 23 Sep 2026 14:00:00 +0000",
        "Message-ID: <eval-trial-1@cadence.example>",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Your Cadence Plus free trial ends Sunday and will renew for $19.99/month.",
        "Cancel anytime in Settings > Subscription before your trial ends to avoid being charged.",
      ].join("\r\n"),
    },
    recording: {
      classify: cls("subscription", 0.97),
      extract: {
        service_name: f("Cadence Plus", "Your Cadence Plus free trial", 0.95),
        plan_name: none,
        amount: usd(19.99, "renew for $19.99/month", 0.97),
        billing_period: f("monthly", "$19.99/month", 0.95),
        status: f("trial", "free trial ends Sunday", 0.95),
        trial_end_date: f("2026-09-27", "Your Cadence Plus free trial ends Sunday", 0.9),
        next_renewal_date: f("2026-09-27", "free trial ends Sunday and will renew", 0.85),
        email_sent_date: f("2026-09-23", "Date: 2026-09-23", 0.95),
      },
    },
    expected: {
      status: "processed",
      items: [{ kind: "subscription", titleIncludes: "Cadence", facts: { trial_end: { certainty: "confirmed", valueDate: "2026-09-27" }, amount: { certainty: "confirmed", valueCents: 1999 } } }],
      deadlines: [{ type: "cancel_trial", dueOn: "2026-09-27", certainty: "confirmed" }],
    },
  },
  {
    id: "renewal_date_mismatch",
    covers: "Model returns a renewal date that its own evidence contradicts",
    file: {
      kind: "eml",
      text: [
        "From: Costco Membership <membership@costco.example>",
        "To: someone@example.com",
        "Subject: Your membership renews soon",
        "Date: Mon, 21 Sep 2026 10:00:00 +0000",
        "Message-ID: <eval-renew-1@costco.example>",
        "",
        "Your Executive Membership will automatically renew on October 21, 2026 for $130.00.",
      ].join("\r\n"),
    },
    recording: {
      classify: cls("subscription", 0.93),
      extract: {
        service_name: f("Costco Executive Membership", "Your Executive Membership", 0.9),
        plan_name: f("Executive", "Executive Membership", 0.9),
        amount: usd(130, "for $130.00", 0.95),
        billing_period: f("annual", "Executive Membership will automatically renew", 0.6),
        status: f("active", "will automatically renew", 0.8),
        trial_end_date: none,
        next_renewal_date: f("2026-10-12", "automatically renew on October 21, 2026", 0.9),
        email_sent_date: f("2026-09-21", "Date: 2026-09-21", 0.95),
      },
    },
    expected: {
      status: "needs_review",
      items: [{ kind: "subscription", facts: { next_renewal: { certainty: "unknown" } } }],
      deadlines: [],
    },
  },
  {
    id: "warranty_document",
    covers: "Warranty certificate with explicit coverage end date",
    file: {
      kind: "pdf",
      lines: [
        "**AppleCare+ for Mac",
        "Proof of Coverage",
        "",
        "Product: MacBook Pro 14-inch (M4 Pro)",
        "Serial Number: C02XK1ABMD6T",
        "Purchase Price: $2,499.00",
        "",
        "Coverage start date: November 2, 2025",
        "Coverage end date: November 1, 2028",
        "",
        "Covers accidental damage and hardware repairs.",
      ],
    },
    recording: {
      classify: cls("warranty", 0.97),
      extract: {
        product_name: f("MacBook Pro 14-inch (M4 Pro)", "Product: MacBook Pro 14-inch (M4 Pro)", 0.95),
        provider: f("AppleCare+", "AppleCare+ for Mac", 0.95),
        purchase_price: usd(2499, "Purchase Price: $2,499.00", 0.95),
        purchase_date: none,
        start_date: f("2025-11-02", "Coverage start date: November 2, 2025", 0.96),
        end_date: f("2028-11-01", "Coverage end date: November 1, 2028", 0.97),
        duration_months: none,
        coverage_summary: f("Accidental damage and hardware repairs", "Covers accidental damage and hardware repairs.", 0.9),
      },
    },
    expected: {
      status: "processed",
      items: [{ kind: "warranty", titleIncludes: "MacBook", facts: { warranty_end: { certainty: "confirmed", valueDate: "2028-11-01" }, purchase_price: { certainty: "confirmed", valueCents: 249900 } } }],
      deadlines: [{ type: "warranty_expiring", dueOn: "2028-11-01", certainty: "confirmed" }],
    },
  },
  {
    id: "airline_credit",
    covers: "Airline credit with expiration",
    file: {
      kind: "eml",
      text: [
        "From: Delta Air Lines <deltaairlines@t.delta.example>",
        "To: someone@example.com",
        "Subject: Your eCredit is ready",
        "Date: Thu, 12 Mar 2026 09:00:00 +0000",
        "Message-ID: <eval-credit-1@delta.example>",
        "",
        "Delta eCredit",
        "Amount: $431.00",
        "eCredit number: 0062143998812",
        "Expires March 12, 2027. New travel must be booked by the expiration date.",
      ].join("\r\n"),
    },
    recording: {
      classify: cls("travel_credit", 0.97),
      extract: {
        carrier: f("Delta Air Lines", "Delta Air Lines", 0.95),
        amount: usd(431, "Amount: $431.00", 0.97),
        expiration_date: f("2027-03-12", "Expires March 12, 2027", 0.96),
        expiration_rule: f("book_by", "New travel must be booked by the expiration date", 0.9),
        credit_code: f("0062143998812", "eCredit number: 0062143998812", 0.95),
        issued_date: f("2026-03-12", "Date: 2026-03-12", 0.9),
      },
    },
    expected: {
      status: "processed",
      items: [{ kind: "travel_credit", facts: { amount: { certainty: "confirmed", valueCents: 43100 }, expires_on: { certainty: "confirmed", valueDate: "2027-03-12" } } }],
      deadlines: [{ type: "use_credit", dueOn: "2027-03-12", certainty: "confirmed" }],
    },
  },
  {
    id: "ambiguous_date",
    covers: "Numeric date that could be day-first or month-first",
    file: {
      kind: "txt",
      text: ["CORNER BOOKS", "12 High Street", "Date: 04/09/2026", "", "The Overstory (paperback)   £12.99", "Pocket atlas                £29.51", "TOTAL                       £42.50", "", "Returns accepted within 28 days of purchase with receipt."].join("\n"),
    },
    recording: {
      classify: cls("purchase_receipt", 0.93),
      extract: {
        orders: [
          {
            merchant: f("Corner Books", "CORNER BOOKS", 0.95),
            purchase_date: f("2026-09-04", "Date: 04/09/2026", 0.55),
            order_number: none,
            line_items: [
              { name: "The Overstory (paperback)", quantity: 1, total_price: 12.99, evidence: "The Overstory (paperback) £12.99", confidence: 0.9 },
              { name: "Pocket atlas", quantity: 1, total_price: 29.51, evidence: "Pocket atlas £29.51", confidence: 0.9 },
            ],
            subtotal: noMoney,
            tax: noMoney,
            total: { value: 42.5, currency: "GBP", evidence: "TOTAL £42.50", confidence: 0.95 },
            payment_last4: none,
            return_policy: { return_days: f(28, "Returns accepted within 28 days of purchase", 0.95), return_by_date: none, policy_text: f("Returns accepted within 28 days of purchase with receipt.", "Returns accepted within 28 days of purchase with receipt.", 0.9) },
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: {
      status: "needs_review",
      items: [{ kind: "purchase", facts: { purchase_date: { certainty: "estimated", valueDate: "2026-09-04" }, return_deadline: { certainty: "estimated", valueDate: "2026-10-02" } } }],
      deadlines: [{ type: "return", dueOn: "2026-10-02", certainty: "estimated" }],
    },
  },
  {
    id: "missing_return_policy",
    covers: "Receipt with no policy from a store we have no policy for",
    file: {
      kind: "pdf",
      lines: ["**JOE'S HARDWARE", "221 Elm St", "Sep 21, 2026  10:12 AM", "", "DEWALT 20V MAX DRILL KIT      159.00", "SUBTOTAL                      159.00", "TAX 8.25%                      13.12", "**TOTAL                       172.12", "", "Thanks for supporting local!"],
    },
    recording: {
      classify: cls("purchase_receipt", 0.96),
      extract: {
        orders: [
          {
            merchant: f("Joe's Hardware", "JOE'S HARDWARE", 0.97),
            purchase_date: f("2026-09-21", "Sep 21, 2026", 0.96),
            order_number: none,
            line_items: [{ name: "DEWALT 20V MAX DRILL KIT", quantity: 1, total_price: 159, evidence: "DEWALT 20V MAX DRILL KIT 159.00", confidence: 0.95 }],
            subtotal: usd(159, "SUBTOTAL 159.00"),
            tax: usd(13.12, "TAX 8.25% 13.12"),
            total: usd(172.12, "TOTAL 172.12", 0.97),
            payment_last4: none,
            return_policy: noPolicy,
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: {
      status: "processed",
      items: [{ kind: "purchase", titleIncludes: "Dewalt", facts: { return_deadline: { certainty: "unknown" }, total: { certainty: "confirmed", valueCents: 17212 } } }],
      deadlines: [],
    },
  },
  {
    id: "multiple_purchases",
    covers: "One email containing two separate orders",
    file: {
      kind: "eml",
      text: [
        "From: Amazon.com <auto-confirm@amazon.example>",
        "To: someone@example.com",
        "Subject: Your Amazon.com orders",
        "Date: Tue, 22 Sep 2026 16:30:00 +0000",
        "Message-ID: <eval-multi-1@amazon.example>",
        "",
        "Order #111-2233445-0000001",
        "Placed on September 19, 2026",
        "Kindle Paperwhite (16 GB) $159.99",
        "Order Total: $173.19",
        "",
        "Order #111-2233445-0000002",
        "Placed on September 22, 2026",
        "Instant Pot Duo 7-in-1, 6 Quart $89.99",
        "Order Total: $97.41",
      ].join("\r\n"),
    },
    recording: {
      classify: cls("order_confirmation", 0.95),
      extract: {
        orders: [
          {
            merchant: f("Amazon", "Amazon.com", 0.95),
            purchase_date: f("2026-09-19", "Placed on September 19, 2026", 0.96),
            order_number: f("111-2233445-0000001", "Order #111-2233445-0000001", 0.96),
            line_items: [{ name: "Kindle Paperwhite (16 GB)", quantity: 1, total_price: 159.99, evidence: "Kindle Paperwhite (16 GB) $159.99", confidence: 0.95 }],
            subtotal: noMoney,
            tax: noMoney,
            total: usd(173.19, "Order Total: $173.19", 0.96),
            payment_last4: none,
            return_policy: noPolicy,
            warranty: noWarranty,
          },
          {
            merchant: f("Amazon", "Amazon.com", 0.95),
            purchase_date: f("2026-09-22", "Placed on September 22, 2026", 0.96),
            order_number: f("111-2233445-0000002", "Order #111-2233445-0000002", 0.96),
            line_items: [{ name: "Instant Pot Duo 7-in-1, 6 Quart", quantity: 1, total_price: 89.99, evidence: "Instant Pot Duo 7-in-1, 6 Quart $89.99", confidence: 0.95 }],
            subtotal: noMoney,
            tax: noMoney,
            total: usd(97.41, "Order Total: $97.41", 0.96),
            payment_last4: none,
            return_policy: noPolicy,
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: {
      status: "processed",
      items: [
        { kind: "purchase", titleIncludes: "Kindle", facts: { return_deadline: { certainty: "estimated", valueDate: "2026-10-19" } } },
        { kind: "purchase", titleIncludes: "Instant Pot", facts: { return_deadline: { certainty: "estimated", valueDate: "2026-10-22" } } },
      ],
      deadlines: [
        { type: "return", dueOn: "2026-10-19", certainty: "estimated" },
        { type: "return", dueOn: "2026-10-22", certainty: "estimated" },
      ],
    },
  },
  {
    id: "duplicate_document",
    covers: "Order email for a purchase already added from its receipt",
    requires: ["clean_receipt"],
    file: {
      kind: "eml",
      text: [
        "From: Best Buy <BestBuyInfo@emailinfo.bestbuy.example>",
        "To: someone@example.com",
        "Subject: Thanks for your order",
        "Date: Sun, 20 Sep 2026 19:00:00 +0000",
        "Message-ID: <eval-dup-1@bestbuy.example>",
        "",
        "Order Number: BBY01-806449213",
        "Order Date: September 20, 2026",
        'Samsung - 65" Class Q80D QLED 4K TV $1,299.99',
        "Geek Squad 2-Year Protection $179.99",
        "Order Total: $1,611.33",
      ].join("\r\n"),
    },
    recording: {
      classify: cls("order_confirmation", 0.96),
      extract: {
        orders: [
          {
            merchant: f("Best Buy", "Best Buy", 0.95),
            purchase_date: f("2026-09-20", "Order Date: September 20, 2026", 0.96),
            order_number: f("BBY01-806449213", "Order Number: BBY01-806449213", 0.97),
            line_items: [
              { name: 'Samsung - 65" Class Q80D QLED 4K TV', quantity: 1, total_price: 1299.99, evidence: 'Samsung - 65" Class Q80D QLED 4K TV $1,299.99', confidence: 0.95 },
              { name: "Geek Squad 2-Year Protection", quantity: 1, total_price: 179.99, evidence: "Geek Squad 2-Year Protection $179.99", confidence: 0.95 },
            ],
            subtotal: noMoney,
            tax: noMoney,
            total: usd(1611.33, "Order Total: $1,611.33", 0.97),
            payment_last4: none,
            return_policy: noPolicy,
            warranty: { duration_months: f(24, "Geek Squad 2-Year Protection", 0.9), provider: f("Geek Squad", "Geek Squad 2-Year Protection", 0.9), ends_on: none, covered_item: none },
          },
        ],
      },
    },
    expected: { status: "processed", items: [{ kind: "purchase", duplicate: true, conflict: false }], deadlines: [] },
  },
  {
    id: "conflicting_documents",
    covers: "Second document for the same order disagrees on the total",
    requires: ["clean_receipt"],
    file: {
      kind: "eml",
      text: [
        "From: Best Buy <BestBuyInfo@emailinfo.bestbuy.example>",
        "To: someone@example.com",
        "Subject: Your order has been updated",
        "Date: Mon, 21 Sep 2026 12:00:00 +0000",
        "Message-ID: <eval-conflict-1@bestbuy.example>",
        "",
        "Order Number: BBY01-806449213",
        "Order Date: September 20, 2026",
        "A price adjustment was applied to your order.",
        "Updated Order Total: $1,579.98",
      ].join("\r\n"),
    },
    recording: {
      classify: cls("order_confirmation", 0.9),
      extract: {
        orders: [
          {
            merchant: f("Best Buy", "Best Buy", 0.95),
            purchase_date: f("2026-09-20", "Order Date: September 20, 2026", 0.96),
            order_number: f("BBY01-806449213", "Order Number: BBY01-806449213", 0.97),
            line_items: [],
            subtotal: noMoney,
            tax: noMoney,
            total: usd(1579.98, "Updated Order Total: $1,579.98", 0.95),
            payment_last4: none,
            return_policy: noPolicy,
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: { status: "needs_review", items: [{ kind: "purchase", duplicate: true, conflict: true }], deadlines: [] },
  },
  {
    id: "poor_ocr_unreadable",
    covers: "Photo too degraded to read",
    file: { kind: "jpg", lines: ["W?LGR??NS", "0?/1?/2026", "T?TAL 2?.49"], style: "unreadable" },
    recording: { transcribe: { text: "[illegible]\n[illegible] 2026\n[illegible]", legibility: "poor" } },
    expected: { status: "needs_review", items: [], deadlines: [] },
  },
  {
    id: "poor_ocr_partial",
    covers: "Poor OCR where key fields are garbled",
    file: { kind: "jpg", lines: ["WALGREENS #0412", "0?/1?/2026 3:14 PM", "ADVIL 200CT      18.99", "T?TAL            2?.49", "RETURNS W/ RECEIPT"], style: "crumpled" },
    recording: {
      classify: cls("purchase_receipt", 0.7),
      transcribe: { text: "WALGREENS #0412\n0?/1?/2026 3:14 PM\nADVIL 200CT 18.99\nT?TAL 2?.49\nRETURNS W/ RECEIPT", legibility: "poor" },
      extract: {
        orders: [
          {
            merchant: f("Walgreens", "WALGREENS #0412", 0.8),
            purchase_date: f("2026-09-12", "0?/1?/2026", 0.3),
            order_number: none,
            line_items: [{ name: "ADVIL 200CT", quantity: 1, total_price: 18.99, evidence: "ADVIL 200CT 18.99", confidence: 0.7 }],
            subtotal: noMoney,
            tax: noMoney,
            total: usd(20.49, "T?TAL 2?.49", 0.3),
            payment_last4: none,
            return_policy: { return_days: f(30, "RETURNS W/ RECEIPT", 0.3), return_by_date: none, policy_text: f("RETURNS W/ RECEIPT", "RETURNS W/ RECEIPT", 0.6) },
            warranty: noWarranty,
          },
        ],
      },
    },
    expected: { status: "needs_review", items: [{ kind: "purchase", facts: { purchase_date: { certainty: "unknown" }, return_deadline: { certainty: "unknown" }, total: { certainty: "unknown" } } }], deadlines: [] },
  },
  {
    id: "unsupported_document",
    covers: "A document with nothing to act on",
    file: { kind: "txt", text: "Grandma's banana bread\n\n3 ripe bananas\n1/3 cup melted butter\n3/4 cup sugar\n1 egg\n1 tsp vanilla\n1 1/2 cups flour\n\nBake at 350F for 60 minutes." },
    recording: { classify: cls("other", 0.9, false) },
    expected: { status: "processed", items: [{ kind: "document" }], deadlines: [] },
  },
  {
    id: "malformed_file",
    covers: "Corrupted PDF",
    file: { kind: "raw", base64: Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\nstream\x00\x01\x02 truncated").toString("base64"), ext: "pdf" },
    expected: { status: "unsupported", items: [], deadlines: [] },
  },
  {
    id: "hallucinated_return_date",
    covers: "Model invents a return-by date that is not on the receipt",
    file: { kind: "txt", text: ["SAM'S BIKES", "Sep 19, 2026", "", "Helmet - Giro Register MIPS   69.99", "Bike lock                     34.00", "TOTAL                        103.99", "", "Thank you!"].join("\n") },
    recording: {
      classify: cls("purchase_receipt", 0.95),
      extract: {
        orders: [
          {
            merchant: f("Sam's Bikes", "SAM'S BIKES", 0.95),
            purchase_date: f("2026-09-19", "Sep 19, 2026", 0.95),
            order_number: none,
            line_items: [
              { name: "Helmet - Giro Register MIPS", quantity: 1, total_price: 69.99, evidence: "Helmet - Giro Register MIPS 69.99", confidence: 0.95 },
              { name: "Bike lock", quantity: 1, total_price: 34, evidence: "Bike lock 34.00", confidence: 0.95 },
            ],
            subtotal: noMoney,
            tax: noMoney,
            total: usd(103.99, "TOTAL 103.99", 0.96),
            payment_last4: none,
            return_policy: { return_days: f(30, "30-day returns", 0.8), return_by_date: f("2026-10-20", "Returns accepted until 10/20/2026", 0.85), policy_text: none },
            warranty: { duration_months: f(12, "1-year warranty on helmets", 0.7), provider: none, ends_on: none, covered_item: none },
          },
        ],
      },
    },
    expected: {
      status: "processed",
      items: [{ kind: "purchase", facts: { return_deadline: { certainty: "unknown" }, purchase_date: { certainty: "confirmed", valueDate: "2026-09-19" } } }],
      deadlines: [],
    },
  },
];
