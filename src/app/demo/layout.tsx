import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Fieldnotes · Sample study", template: "%s · Fieldnotes · Sample" },
  description: "An original, synthetic study prototype. Prewritten content and feedback; no live AI, accounts or academic records.",
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}