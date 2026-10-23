import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { TestRecovery } from "../screens/test-recovery";

export const metadata: Metadata = { title: "Test & recovery" };

export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="Learning · Test & recovery">
      <TestRecovery />
    </ProductShell>
  );
}
