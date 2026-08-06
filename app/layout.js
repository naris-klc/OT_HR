import './styles.css';
import './print.css';

export const metadata = {
  title: 'ระบบขออนุมัติทำงานล่วงเวลา · Primus Instrument',
  description: 'ระบบขออนุมัติทำงานล่วงเวลา บริษัท ไพรมัส อินสตรูเมนท์ จำกัด — F-HR-027 Rev.4',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
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
