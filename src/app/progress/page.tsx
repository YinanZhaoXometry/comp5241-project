import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { Progress } from "../screens/progress";

export const metadata: Metadata = { title: "Progress" };

export default function Page() {
  return (
    <ProductShell active={"progress"} breadcrumb="Learning · Progress">
      <Progress />
    </ProductShell>
  );
}
