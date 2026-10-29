import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { EnrolledList } from "../screens/enrolled-list";

export const metadata: Metadata = { title: "Enrolled courses" };

// LIVE learner route (epic-5 entry 1): the enrolled learner's instructor
// courses under the product shell, behind the server's enrollment fence.
export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="Enrolled courses">
      <EnrolledList />
    </ProductShell>
  );
}
