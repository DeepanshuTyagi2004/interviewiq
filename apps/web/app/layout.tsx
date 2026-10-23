import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { QueryProvider } from "@/lib/providers/QueryProvider";
import { ThemeProvider } from "@/lib/providers/ThemeProvider";
import { PostHogProvider } from "@/lib/providers/PostHogProvider";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { WakeServices } from "@/lib/providers/WakeServices";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display" });

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
      className={`${inter.variable} ${display.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans">
        <WakeServices />
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
