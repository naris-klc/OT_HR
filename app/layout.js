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

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
