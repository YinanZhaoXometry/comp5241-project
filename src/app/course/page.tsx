import type { Metadata } from "next";
import { ProductShell } from "../shell/product-shell";
import { CourseFull } from "../screens/course-full";

export const metadata: Metadata = { title: "Course player" };

export default function Page() {
  return (
    <ProductShell active={null} breadcrumb="Learning · Course player">
      <CourseFull />
    </ProductShell>
  );
}
