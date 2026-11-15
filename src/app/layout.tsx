import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { AppProviders } from "@/lib/client/AppProviders";
import { getI18nProps } from "@/i18n/server";

const onest = Onest({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  variable: "--font-onest",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Irreplaceable · Afraid AI will replace you? Become irreplaceable",
  description:
    "Your job, task by task: what AI already does, what stays yours, and ten-minute daily reps built from your own work.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const i18n = await getI18nProps();
  return (
    <html lang={i18n.locale} className={onest.variable}>
      <body>
        <AppProviders {...i18n}>{children}</AppProviders>
      </body>
    </html>
  );
}
