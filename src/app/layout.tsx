import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Konkan Coastal Foods HRMS",
  description: "HR system for Konkan Coastal Foods",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
