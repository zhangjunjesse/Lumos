import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { AppLayout } from "@/components/layout/app-layout";
import { ProAuthGate } from "@/components/layout/ProAuthGate";
import { MemoryToastProvider } from "@/components/memory/memory-toast-container";
import { ScheduleNotifications } from "@/components/workflow/ScheduleNotifications";

export const metadata: Metadata = {
  title: "Lumos",
  description: "Document intelligence assistant powered by AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <I18nProvider>
            <MemoryToastProvider>
              <ProAuthGate>
                <AppLayout>{children}</AppLayout>
                <ScheduleNotifications />
              </ProAuthGate>
            </MemoryToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
