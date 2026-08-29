/**
 * Money is integer minor units (cents) end to end (CLAUDE.md); formatting to
 * a display string is the renderer's job. Locale/currency-symbol formatting
 * is explicitly NOT attempted here — Stage 0-2 rule is "never optimize
 * typography", and docs/RESULTS.md's Typst spike used a plain
 * grouped-decimal format (see the ported `#money()` Typst helper in
 * emit-typst.ts). This is the same format, done in JS for values we already
 * know at generation time (everything except a carry-forward running total,
 * which is only known once Typst has decided where page breaks land).
 */

/** `123456` -> `"1,234.56"`. Negative cents -> a leading `-`. */
export function formatMoneyCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = groupThousands(String(whole));
  const fracStr = String(frac).padStart(2, '0');
  return (negative ? '-' : '') + wholeStr + '.' + fracStr;
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    if (i !== 0 && fromEnd % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * A path is treated as a "money amount" field — and therefore cents that
 * need decimal formatting rather than being printed as a raw integer — when
 * its final segment is `amount`, matching the `Money { currency, amount }`
 * shape (packages/schema/src/contract/data-contract.ts) used throughout the
 * PO contract (unitPrice.amount, netAmount.amount, totals.*.amount).
 */
export function isMoneyAmountPath(path: string): boolean {
  return path === 'amount' || path.endsWith('.amount');
}

/**
 * Stage 6: locale-aware money display, wired through `Renderer.render()`'s
 * `opts.locale` (packages/schema/src/renderer.ts). `Intl.NumberFormat` is a
 * core-JS API — no new dependency, no external binary. With no locale this
 * falls back to `formatMoneyCents` unchanged, so every pre-Stage-6 corpus
 * case (rendered without a locale) keeps its exact prior byte output.
 *
 * Money stays integer cents end to end (CLAUDE.md) — `cents / 100` is only
 * ever used to feed a *display* formatter that rounds to exactly 2 fraction
 * digits; the float error from that division is many orders of magnitude
 * smaller than the 2-decimal rounding threshold, so it never changes a
 * printed digit.
 *
 * Verified empirically (see this task's session report) that `ar-SA`
 * really does print Arabic-Indic digits (e.g. "١٬٢٣٤٫٥٦") via Node's ICU —
 * not assumed.
 */
export function formatMoneyCentsLocale(cents: number, locale?: string): string {
  if (!locale) return formatMoneyCents(cents);
  const amount = cents / 100;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for the plain `YYYY-MM-DD` ISO date strings the data contract uses (poDate, invoiceDate, dueDate, ...). */
export function looksLikeIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

/**
 * Locale-aware date display for the contract's plain ISO date strings.
 * `timeZone: 'UTC'` pins the parse to the calendar date the string names —
 * the contract has no time-of-day component, so treating it as local time
 * risks the date itself shifting by a day near a locale's UTC offset.
 *
 * Verified empirically (not assumed): `Intl.DateTimeFormat('th-TH', ...)`
 * defaults to the Thai solar (Buddhist Era) calendar — e.g. `2026-08-27` ->
 * "27/08/2569" (2026 + 543). This is the real convention for Thai-locale
 * dates, not a bug; flagged here since it's the one locale where the
 * printed year number genuinely differs from the ISO year.
 */
export function formatIsoDateLocale(iso: string, locale?: string): string {
  if (!locale) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(dt);
}

/** The subset of `Address` (data-contract.ts) shape-detection needs — kept local so format.ts stays dependency-free on `@busy-office/output-schema` types. */
export interface AddressLike {
  line1: string;
  line2?: string;
  city: string;
  postalCode?: string;
  country: string;
}

/** Shape-detects an `Address` value (vs. a plain string/number field) purely by structure — no path-name lookup table needed. */
export function isAddressLike(value: unknown): value is AddressLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).line1 === 'string' &&
    typeof (value as Record<string, unknown>).city === 'string' &&
    typeof (value as Record<string, unknown>).country === 'string'
  );
}

type AddressLineOrder = 'western' | 'postal-first';

interface AddressLocaleRule {
  order: AddressLineOrder;
  rtl: boolean;
}

/**
 * Small, explicit lookup — just the four Stage 6 exit-gate locales, not a
 * universal address-formatting library (CLAUDE.md: never gold-plate).
 *
 * Conventions (verified against real practice, not guessed):
 *  - en-SG, th-TH: Western/small-to-large order — street line(s), then
 *    "city postalCode", country last. Thai postal addressing (Thailand
 *    Post) runs smallest-to-largest with the postal code trailing the
 *    province/city, same shape as the Western case.
 *  - ja-JP: Japanese domestic convention prints the postal code FIRST
 *    (with a leading `〒` mark in real mail, omitted here since the
 *    contract has no such field), then works down from the city/prefecture
 *    to the street — i.e. postal+city before the street line, reversed
 *    from Western order.
 *  - ar-SA: Saudi Arabia's National Address format keeps the same
 *    small-to-large line order as the Western case (building/street,
 *    district/city + postal code, country) — the real difference is
 *    script direction, not line order, so `rtl: true` is recorded here for
 *    callers that need to know, while the *order* stays `'western'`.
 */
const ADDRESS_RULES: Record<string, AddressLocaleRule> = {
  'en-SG': { order: 'western', rtl: false },
  'ja-JP': { order: 'postal-first', rtl: false },
  'th-TH': { order: 'western', rtl: false },
  'ar-SA': { order: 'western', rtl: true },
};

const DEFAULT_ADDRESS_RULE: AddressLocaleRule = { order: 'western', rtl: false };

function addressRuleForLocale(locale?: string): AddressLocaleRule {
  if (!locale) return DEFAULT_ADDRESS_RULE;
  return ADDRESS_RULES[locale] ?? DEFAULT_ADDRESS_RULE;
}

/** True when the render locale's script conventionally runs right-to-left (just `ar-SA` among the four exit-gate locales). */
export function isRtlLocale(locale?: string): boolean {
  return addressRuleForLocale(locale).rtl;
}

/** Renders an address as an ordered list of display lines, per `addressRuleForLocale`. */
export function formatAddressLines(address: AddressLike, locale?: string): string[] {
  const rule = addressRuleForLocale(locale);
  const streetLines = [address.line1, address.line2].filter((x): x is string => Boolean(x));
  const cityPostalWestern = [address.city, address.postalCode].filter(Boolean).join(' ');
  const postalCityJp = [address.postalCode, address.city].filter(Boolean).join(' ');
  const lines =
    rule.order === 'postal-first' ? [postalCityJp, ...streetLines] : [...streetLines, cityPostalWestern];
  lines.push(address.country);
  return lines;
}

/**
 * One value formatter shared by every emit site (fieldGrid, table cells,
 * totals rows) that prints a bound leaf value as a single line of text —
 * money and dates get locale-aware display; an address value (multi-line,
 * only meaningful in fieldGrid) is joined with ", " here for the
 * single-line callers and handled specially by the fieldGrid emitter for
 * its real multi-line form. Anything else falls back to plain `String()`.
 */
export function formatDisplayValue(path: string, value: unknown, locale?: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && isMoneyAmountPath(path)) return formatMoneyCentsLocale(value, locale);
  if (looksLikeIsoDate(value)) return formatIsoDateLocale(value, locale);
  if (isAddressLike(value)) return formatAddressLines(value, locale).join(', ');
  return String(value);
}
