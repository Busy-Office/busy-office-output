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
