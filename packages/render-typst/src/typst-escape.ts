/**
 * Escapes an arbitrary runtime string (party names, addresses, descriptions
 * — real data, not template-authored markup) for safe interpolation into
 * Typst *markup* mode content blocks (`[...]`). Every character Typst's
 * markup grammar treats specially is backslash-escaped; nothing here is
 * meant to be clever, just to stop data from being interpreted as markup
 * (e.g. a vendor name containing `_` or `#` must not toggle emphasis or
 * start code mode).
 */
const SPECIAL = /[\\#\[\]<>@*_$`~]/g;

export function escapeTypstMarkup(value: string): string {
  return value.replace(SPECIAL, (ch) => '\\' + ch);
}

/** Escapes a string for use inside a Typst *string literal* (`"..."`, e.g. inside code mode / metadata()). */
export function escapeTypstStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
