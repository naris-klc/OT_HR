# public/

Files here are served from the site root: `public/logo.png` → `/logo.png`.

## logo.png — โลโก้บริษัท

**Save the Primus logo here, named exactly `logo.png`.** Nothing else has to
change: the sidebar, the mobile top bar and the login panel all read it at
runtime, and a refresh picks it up. No rebuild, no restart.

Until the file exists, all three fall back to the two-letter **Pm** tile the app
shipped with — see `BrandMark` in `components/App.jsx`. That is why a missing
logo costs a plainer badge instead of a broken-image icon in the corner of every
screen, on a system whose users could not fix it and would reasonably read it as
the app being broken.

What the artwork should be:

- **PNG with a transparent background.** The tile behind it turns white when the
  logo loads, and a white rectangle baked into the image would show as a square
  inside a rounded corner.
- **Roughly square, and not small.** It is drawn at 30–40 px, so 256×256 or more
  leaves room for a high-DPI screen. It is scaled with `object-fit: contain`, so
  a taller-than-wide source is letterboxed rather than cropped — nothing is cut
  off, it just sits smaller in the tile.
- **Trimmed.** Whitespace baked around the edges of the file becomes padding on
  top of the 3 px the stylesheet already adds, and the mark ends up looking
  shrunken beside the wordmark next to it.

## The browser tab icon is a second file, and it is DERIVED from this one

`app/icon.png` — Next.js picks that path up by App Router convention and writes
the `<link rel="icon">` itself; nothing in this project configures it.

It is **not** a copy of `logo.png`. It is generated from it by
`node scripts/make-icon.js`, which does three things a 16 px icon needs:

- **Crops to the Pm mark**, dropping the word PRIMUS. At 16 px that word is a
  green smudge under the mark — which is why brand systems keep a mark separate
  from the full lockup.
- **Makes white transparent**, keeping the anti-aliased edges soft. Every pixel
  in the artwork is the same green blended with white, so the blend is undone
  rather than thresholded. A tab bar is light in one theme and dark in the
  other, and an opaque white square is obvious in the second.
- **Box-filter downscales** to 128×128 — 8× the 16 px icon and 4× the 32 px one.

**If you replace `logo.png`, run that script again**, or the tab keeps the old
mark and nothing says so. The script measures where the mark is rather than
using fixed coordinates, so differently proportioned artwork still works.
