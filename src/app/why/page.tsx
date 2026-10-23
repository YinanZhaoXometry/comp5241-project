import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { WhyExplorer } from "../screens/why-explorer";

export const metadata: Metadata = { title: "Why explorer" };

export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="Learning · Why explorer">
      <WhyExplorer />
    </ProductShell>
  );
}
