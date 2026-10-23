import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { Roadmap } from "../screens/roadmap";

export const metadata: Metadata = { title: "Roadmap" };

export default function Page() {
  return (
    <ProductShell active={"roadmap"} breadcrumb="Learning · Roadmap">
      <Roadmap />
    </ProductShell>
  );
}
