import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { StartingCheck } from "../screens/starting-check";

export const metadata: Metadata = { title: "Starting check" };

export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="Learning · Starting check">
      <StartingCheck />
    </ProductShell>
  );
}
