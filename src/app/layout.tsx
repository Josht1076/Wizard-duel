import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wizard Duel",
  description: "Invite-only two-phone Wizard Duel playtest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
