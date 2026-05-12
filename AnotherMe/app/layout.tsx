import type { Metadata } from 'next';
import './globals.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/layout/server-providers-init';
import { AuthProvider } from '@/features/auth/components/auth-provider';
import { PwaRuntime } from '@/components/pwa/pwa-runtime';
import { KeyboardProvider } from '@/lib/contexts/keyboard-context';

export const metadata: Metadata = {
  title: '镜我 - AI 教育平台',
  description: 'AI 驱动的教育平台，用于创建互动课堂和解答问题。',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '镜我',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    siteName: '镜我',
    title: '镜我 - AI 教育平台',
    description: 'AI 驱动的教育平台，用于创建互动课堂和解答问题。',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#6366f1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="镜我" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <KeyboardProvider>
            <AuthProvider>
              <I18nProvider>
                <ServerProvidersInit />
                {children}
                <PwaRuntime />
                <Toaster position="top-center" />
              </I18nProvider>
            </AuthProvider>
          </KeyboardProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
