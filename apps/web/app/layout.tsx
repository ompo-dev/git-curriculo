import type { Metadata } from "next";

import "@gitcurriculo/ui/src/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Git Curriculo",
  description: "Analise GitHub e geracao de curriculo ATS"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): JSX.Element {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-[var(--gc-bg)] text-[var(--gc-text)] antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
