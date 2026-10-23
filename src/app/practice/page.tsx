import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { PracticeFull } from "../screens/practice-full";

export const metadata: Metadata = { title: "Practice" };

export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="Learning · Practice & recall">
      <PracticeFull />
    </ProductShell>
  );
}
