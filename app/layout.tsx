import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TravelBuddy – NYC MVP',
  description: 'AI-powered, flexible city itineraries',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
