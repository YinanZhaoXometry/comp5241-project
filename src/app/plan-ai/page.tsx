import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { PlanAi } from "../screens/plan-ai";

export const metadata: Metadata = { title: "Plan · AI-assisted" };

export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="New study · AI-assisted plan">
      <PlanAi />
    </ProductShell>
  );
}
