'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2 } from 'lucide-react';

export async function generateQrDataUrl(
  text: string,
  options?: { width?: number; margin?: number; darkColor?: string; lightColor?: string }
): Promise<string> {
  if (!text) return '';
  return QRCode.toDataURL(text, {
    width: options?.width ?? 320,
    margin: options?.margin ?? 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: options?.darkColor ?? '#1b2430',
      light: options?.lightColor ?? '#ffffff',
    },
  });
}

export async function downloadQrPng(
  text: string,
  filename: string,
  width = 640
): Promise<boolean> {
  if (!text || typeof document === 'undefined') return false;
  try {
    const dataUrl = await generateQrDataUrl(text, { width, margin: 3 });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch (err) {
    console.warn('[QrCode] downloadQrPng error:', err);
    return false;
  }
}

interface QrCodeImageProps {
  value: string;
  size?: number;
  alt?: string;
  className?: string;
  margin?: number;
  darkColor?: string;
}

export function QrCodeImage({
  value,
  size = 240,
  alt = 'Mã QR',
  className = 'w-40 h-40 object-contain',
  margin = 2,
  darkColor = '#1b2430',
}: QrCodeImageProps) {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setSrc('');
      return;
    }
    generateQrDataUrl(value, { width: Math.max(size * 2, 320), margin, darkColor })
      .then(url => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc('');
      });
    return () => {
      active = false;
    };
  }, [value, size, margin, darkColor]);

  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-white text-slate-400 ${className}`}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return <img src={src} alt={alt} width={size} height={size} className={className} />;
}
