import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Fieldnotes · Private study", description: "Local synthetic TXT-to-Manual-plan tracer. No AI processing or course generation." };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}