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
  /**
   * No maximumScale, deliberately.
   *
   * It used to be pinned to 1, which stops pinch-zoom on iOS and Android. That
   * is a WCAG 2.1 AA failure (1.4.4) and it bites the people least able to
   * work around it: anyone who needs to magnify a salary figure or a clause in
   * the terms simply could not. The usual reason for pinning it — stopping iOS
   * zooming when a text input is focused — is already solved here by inputs
   * inheriting a 15px+ font size.
   */
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
