import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import PwaRegister from './components/PwaRegister';
import Wordmark from './components/Wordmark';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Travel Buddy',
  description: "A day in New York from Sam and Kailey's list.",
  applicationName: 'Travel Buddy',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Travel Buddy',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F2F2F7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <header
          className="sticky top-0 z-20 bg-grouped/95 backdrop-blur"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-2">
            <Wordmark />
            <span className="text-[13px] font-semibold tracking-wide text-mute">NYC</span>
          </div>
        </header>
        <div className="mx-auto min-h-[100dvh] max-w-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
        <PwaRegister />
      </body>
    </html>
  );
}
