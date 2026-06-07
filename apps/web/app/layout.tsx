import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { QueryProvider } from "@/lib/providers/QueryProvider";
import { ThemeProvider } from "@/lib/providers/ThemeProvider";
import { PostHogProvider } from "@/lib/providers/PostHogProvider";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "InterviewIQ",
  description: "Interview preparation platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <PostHogProvider>
                {children}
                <Toaster />
              </PostHogProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
