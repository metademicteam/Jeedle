import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jeedle · Football Decision Playground",
  description:
    "Rank today's football fixtures with TypeSafe AI — composite-scored with Jev. A Metademic project.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
