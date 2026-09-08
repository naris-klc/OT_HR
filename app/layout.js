import './styles.css';
import './print.css';

export const metadata = {
  title: 'ระบบขออนุมัติทำงานล่วงเวลา · Primus Instrument',
  description: 'ระบบขออนุมัติทำงานล่วงเวลา บริษัท ไพรมัส อินสตรูเมนท์ จำกัด — F-HR-027 Rev.4',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  /**
   * Without this, `env(safe-area-inset-*)` resolves to 0 — on every device,
   * silently. The bottom sheet's buttons and the mobile nav bar both pad
   * themselves past the home indicator on iOS and the gesture bar on Android,
   * and neither was doing anything.
   *
   * It also lets the page run under the rounded corners and the notch, so
   * everything anchored to a screen edge takes the horizontal insets too —
   * see the 860px block in styles.css.
   */
  viewportFit: 'cover',
};

/**
 * ธีมที่เลือกไว้ ทาลงบน <html> ก่อนหน้าจอวาดครั้งแรก.
 *
 * Inline and `beforeInteractive` by construction — it runs where it is
 * written, before the body paints. A theme applied from a React effect would
 * paint the system's answer first and swap a frame later, and the person most
 * likely to notice that flash is the one who went and set the theme by hand.
 *
 * It reads one key and sets one attribute; everything else is CSS (see the
 * `light-dark()` block in styles.css). Wrapped in try/catch because
 * localStorage throws rather than returns null in a locked-down browser, and a
 * theme is not worth a blank page.
 *
 * No value stored means no attribute, which is the system's preference — the
 * default this app had before it had a setting at all.
 */
const THEME_BOOT = `try{var t=localStorage.getItem('ot-theme');`
  + `if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    /**
     * `suppressHydrationWarning` IS THE POINT OF THE SCRIPT ABOVE, not a way of
     * quietening it.
     *
     * THEME_BOOT writes `data-theme` onto this very element before React
     * hydrates — that is its whole job. The server cannot have written it: the
     * value lives in the browser's localStorage and no request carries it, so
     * the markup React rendered carries no theme attribute at all and the DOM it
     * wakes up to carries data-theme="light". React compares them, finds an
     * attribute it did not put there, and reports a hydration mismatch.
     *
     * The prose here deliberately spells no complete html tag. The test that
     * pins this reads the file as text, and a comment quoting the tag it is
     * looking for satisfies the assertion on its own — which is exactly how a
     * no-op shipped once already, green.
     *
     * The mismatch is intended and permanent, which is exactly the case this
     * attribute exists for. It applies to THIS element only — one level, never
     * the tree — so a real mismatch anywhere inside the app is still reported.
     *
     * The alternative is a cookie, so the server can render the attribute
     * itself. It would remove the mismatch honestly rather than declare it
     * expected, at the price of a cookie on every request and a theme that
     * leaves the browser it belongs to. Not worth it for one attribute.
     */
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
