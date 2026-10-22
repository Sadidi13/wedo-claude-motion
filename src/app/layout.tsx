import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Motion Studio",
  description:
    "Layer-based editor for Claude Motion animations: edit layers by hand or ask Claude to rewrite one.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
