

import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Analytics } from '@vercel/analytics/next'
import LayoutContent from './client-layout'
import './globals.css'
import { ConvexClientProvider } from '@/providers/ConvexClientProvider'
import { AuthGuard } from '@/components/AuthGuard'

const geist = Geist({ subsets: ["latin"], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'SIRz Admin Dashboard',
  description: 'AI-powered platform for managing brands, campaigns, and ambassadors',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased dark`} suppressHydrationWarning>
        <ConvexClientProvider>
              <AuthGuard>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
            <LayoutContent>
                {children}
            </LayoutContent>
            <Analytics />
          </ThemeProvider>
              </AuthGuard>
        </ConvexClientProvider>
      </body>
    </html>
  )
}
