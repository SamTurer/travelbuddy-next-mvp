import './globals.css';
import type { Metadata, Viewport } from 'next';
import PwaRegister from './components/PwaRegister';

export const metadata: Metadata = {
  title: 'TravelBuddy NYC',
  description: "A day in New York from Sam and Kailey's list.",
  applicationName: 'TravelBuddy',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TravelBuddy',
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
  themeColor: '#0b1f33',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-20 bg-[#0b1f33] text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <span className="text-base font-semibold tracking-tight">TravelBuddy</span>
            <span className="text-xs font-medium uppercase tracking-wider text-slate-300">NYC</span>
          </div>
        </header>
        <div className="mx-auto min-h-[100dvh] max-w-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
        <PwaRegister />
      </body>
    </html>
  );
}
