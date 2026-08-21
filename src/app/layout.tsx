import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jobsy — Swipe. Match. Get hired.",
  description:
    "Two-sided swipe hiring. Candidates swipe jobs, recruiters swipe candidates, and a mutual right-swipe opens the conversation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  // Must track --bg in globals.css. This is the colour iOS and Android paint
  // the browser chrome with, so when it drifts from the page background the
  // top of the screen is visibly a different shade than the app under it.
  themeColor: "#0a0d13",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
