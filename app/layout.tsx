import type { Metadata } from "next";
import "./globals.css";
import { PRIVATE_ROBOTS, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Fantasy Basketball Desk",
  description: "Private Yahoo Fantasy Basketball weekly report and daily free-agent recommendations.",
  robots: PRIVATE_ROBOTS,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
