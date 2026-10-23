import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { OwnerExport } from "../screens/owner-export";

export const metadata: Metadata = { title: "Privacy & data" };

export default function Page() {
  return (
    <ProductShell active={"data"} breadcrumb="Fieldnotes · Privacy & data">
      <OwnerExport />
    </ProductShell>
  );
}
