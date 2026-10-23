import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { LibraryScreen } from "../screens/library";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return (
    <ProductShell active={"library"} breadcrumb="Fieldnotes · Library">
      <LibraryScreen />
    </ProductShell>
  );
}
