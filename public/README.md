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

## The browser tab icon is separate

`logo.png` does not become the favicon. Next.js takes that from a file named
`app/icon.png` (or `app/favicon.ico`) — App Router convention, not something
this project configures. Dropping a copy there names the tab too; leaving it
alone keeps the default. Same picture, second file, deliberately: the tab icon
is 16 px and a mark that reads at 34 px often needs a cropped version to survive
that.
