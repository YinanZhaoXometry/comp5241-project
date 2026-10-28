import type { Metadata } from "next";
import { ProductShell } from "../../shell/product-shell";
import { EnrolledCourse } from "../../screens/enrolled-course";

export const metadata: Metadata = { title: "Approved lesson" };

// LIVE learner route (epic-5 entry 1): one enrolled course's APPROVED lesson
// only — drafts, other versions and the roster are never served here, and
// every non-enrolled visitor gets the same no-existence-leak denial.
type Context = { params: Promise<{ courseId: string }> };

export default async function Page(context: Context) {
  const { courseId } = await context.params;
  return (
    <ProductShell active={null} breadcrumb="Enrolled · Approved lesson">
      <EnrolledCourse courseId={courseId} />
    </ProductShell>
  );
}
