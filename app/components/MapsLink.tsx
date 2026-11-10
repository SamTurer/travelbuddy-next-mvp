'use client';

import React from 'react';

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Opens the https Maps URL in the Google Maps app on iOS when it is installed. */
export function openGoogleMaps(httpsUrl: string) {
  if (!isIos()) {
    window.open(httpsUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  const appUrl = httpsUrl.replace(/^https:\/\//, 'comgooglemapsurl://');
  const started = Date.now();
  window.location.href = appUrl;
  window.setTimeout(() => {
    if (document.visibilityState === 'visible' && Date.now() - started < 1600) {
      window.location.href = httpsUrl;
    }
  }, 700);
}

export default function MapsLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={(event) => {
        if (!isIos()) return;
        event.preventDefault();
        openGoogleMaps(href);
      }}
    >
      {children}
    </a>
  );
}
