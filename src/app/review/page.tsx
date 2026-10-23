import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { ReviewInbox } from "../screens/review-inbox";

export const metadata: Metadata = { title: "Review inbox" };

export default function Page() {
  return (
    <ProductShell active={"review"} breadcrumb="Learning · Review inbox">
      <ReviewInbox />
    </ProductShell>
  );
}
