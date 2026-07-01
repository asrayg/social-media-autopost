import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "AutoPost — Social Media Scheduler",
    template: "%s | AutoPost",
  },
  description: "Schedule and autopost to multiple social media platforms from one place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background text-foreground antialiased",
          inter.className
        )}
      >
        <div className="flex min-h-screen">
          {/* Fixed left sidebar */}
          <Sidebar />

          {/* Main column */}
          <div
            className="flex min-w-0 flex-1 flex-col"
            style={{ paddingLeft: "var(--sidebar-width)" }}
          >
            <Header />
            <main className="flex-1 overflow-auto">
              <div className="mx-auto w-full max-w-7xl px-6 py-6 md:px-8">
                {children}
              </div>
            </main>
          </div>
        </div>

        <Toaster />
      </body>
    </html>
  );
}
