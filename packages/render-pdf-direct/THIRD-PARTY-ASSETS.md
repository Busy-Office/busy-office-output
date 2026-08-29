# Third-party assets embedded by `@busy-office/render-pdf-direct`

Every artifact this renderer produces embeds two third-party files verbatim
(PDF/A-2b requires embedded fonts and an ICC-based OutputIntent — ADR-006,
docs/STANDARDS.md). Both are checked in under `assets/` with their licence
text so the repo's open licence question (ADR-008) can be answered with the
actual terms in hand, not from memory.

| Asset | File(s) | Source | Version | Licence | Redistribution / embedding |
|---|---|---|---|---|---|
| DejaVu Sans (Regular, Bold) | `assets/dejavu/DejaVuSans.ttf`, `assets/dejavu/DejaVuSans-Bold.ttf` | https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip | 2.37 | Bitstream Vera Fonts Copyright (permissive, MIT-style) + Arev Fonts Copyright; DejaVu changes are public domain. Full text: `assets/dejavu/LICENSE` | Permitted: "reproduce and distribute ... use, copy, merge, publish, distribute, and/or sell copies", including embedding in documents. Conditions: keep the copyright notice (this file + `LICENSE`); a *modified* font may not be distributed under the "Bitstream Vera" name — we do not modify the font (PDF subsetting on output is not a redistribution of a modified font under a Vera name; the embedded subset carries the original name, which is the norm for every PDF producer embedding Vera/DejaVu). No copyleft, no attribution-on-output clause. |
| sRGB2014 ICC profile (ICC v2) | `assets/icc/sRGB2014.icc` | https://registry.color.org/rgb-registry/profiles/sRGB2014.icc (linked from https://www.color.org/srgbprofiles.xalter) | 2015-02 revision, 3024 bytes | International Color Consortium profile licence (https://registry.color.org/profile-library/#license): "This profile is made available by the International Color Consortium, and may be copied, distributed, embedded, made, used, and sold without restriction. Altered versions of this profile shall have the original identification and copyright information removed and shall not be misrepresented as the original profile." Copyright tag in the profile: "Copyright International Color Consortium, 2015". | Permitted without restriction, embedding explicitly named. We embed it unaltered. |

SHA-256 of the checked-in bytes (so a silent swap is detectable):

```
7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954  assets/dejavu/DejaVuSans.ttf
e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724  assets/dejavu/DejaVuSans-Bold.ttf
384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a  assets/icc/sRGB2014.icc
```

Why DejaVu Sans and not Liberation Sans: Liberation is SIL OFL 1.1, which
is also fine, but DejaVu's licence has no Reserved Font Name clause to
reason about when the embedded subset keeps the family name, and DejaVu
Sans has the widest Latin coverage (Latin-1, Latin Extended-A/B) of the
common permissive sans faces — the whole Latin range ADR-001 routes to
pdf-direct is covered by one file. Not chosen for looks: Stage 0-2 rule,
never optimize typography.

Why the ICC v2 profile and not the v4 preference profile: PDF/A-2 allows
either; the v2 sRGB profile is the conventional choice for a PDF/A
OutputIntent, veraPDF 1.30 passes it (144/144 rules on every corpus
artifact), and it is smaller (3 KB vs 60 KB).
