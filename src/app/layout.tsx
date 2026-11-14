import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "@/styles/tokens.css";
import "@/styles/base.css";

const onest = Onest({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  variable: "--font-onest",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Irreplaceable · Train the part of your job AI gets wrong",
  description:
    "Your job, task by task: what AI already does, what stays yours, and ten-minute daily reps built from your own work.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={onest.variable}>
      <body>{children}</body>
    </html>
  );
}
