import Script from 'next/script';
import './globals.css';

export const metadata = {
  title: 'CommunAuto Finder',
  description: 'Discover nearby Communauto vehicles with live map tracking and smart alerts.',
};

export default function RootLayout({ children }) {
  const adsClient = process.env.NEXT_PUBLIC_GOOGLE_ADS_CLIENT;

  return (
    <html lang="en">
      <body>
        {adsClient ? (
          <Script
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`}
            strategy="afterInteractive"
            crossOrigin="anonymous"
          />
        ) : null}
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`}
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
