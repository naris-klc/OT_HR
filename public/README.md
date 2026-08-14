# public/

Files here are served from the site root: `public/logo.png` → `/logo.png`.

## Two files, and only one of them is drawn

| file | what it is | who draws it |
|---|---|---|
| `logo.png` | the supplied artwork — the Pm mark **over the word PRIMUS** | nothing. it is the SOURCE |
| `logo-mark.png` | the Pm mark alone, cropped out of it, transparent | the sidebar, the mobile bar, the login panel |

`logo-mark.png` and `app/icon.png` are both **generated** from `logo.png` by
`node scripts/make-icon.js`. **Replace `logo.png` and run that script**, or the
badges and the browser tab keep the old mark and nothing says so.

### Why the badges do not use the full artwork

Every place the badge appears it is 30–40 px, and the app has already written
**PRIMUS** in text right beside it. Drawing the full lockup put the word on
screen twice: once set cleanly in type, and once about five pixels tall inside
the badge, where it reads as a green smudge under the mark. Using the mark
alone is what a lockup has a separate mark *for*.

Until `logo-mark.png` exists, all three badges fall back to the two-letter
**Pm** tile the app shipped with — see `BrandMark` in `components/App.jsx`. That
is why a missing file costs a plainer badge instead of a broken-image icon in
the corner of every screen, on a system whose users could not fix it and would
reasonably read it as the app being broken.

What the source artwork (`logo.png`) should be:

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

## What the generator does

`node scripts/make-icon.js` writes `public/logo-mark.png` (256 px, for the
badges) and `app/icon.png` (128 px, the browser tab — Next.js picks that path up
by App Router convention and writes the `<link rel="icon">` itself). Three
steps, and the size of a tab icon is the reason for each:

- **Crops to the Pm mark**, by measurement rather than fixed coordinates: the
  bands of the lockup are separated by blank rows, so the first run of rows with
  ink is the mark. Differently proportioned artwork still works.
- **Makes white transparent**, keeping the anti-aliased edges soft. Every pixel
  in the artwork is the same green blended with white, so the blend is undone
  rather than thresholded. A tab bar is light in one theme and dark in the
  other, and an opaque white square is obvious in the second.
- **Box-filter downscales.** Nearest-neighbour at these ratios drops most of the
  image on the floor and takes the thin strokes of the "m" with it.
