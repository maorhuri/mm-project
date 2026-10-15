'use client';

import { DirectionProvider } from '@radix-ui/react-direction';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DirectionProvider dir="rtl">
        {children}
        <Toaster position="top-center" dir="rtl" richColors closeButton />
      </DirectionProvider>
    </ThemeProvider>
  );
}
