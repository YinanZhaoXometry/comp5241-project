import type { Metadata } from "next";
import { InstructorShell } from "../../shell/instructor-shell";
import { InstructorCourses } from "../../screens/instructor-courses";

export const metadata: Metadata = { title: "Instructor · Courses" };

// LIVE instructor route (epic-5 entry 1): the static prototype port became a
// real surface over /api/v1/instructor/courses… behind the server's
// instructor-role and ownership fences. The honesty label stays visible.
export default function Page() {
  return (
    <InstructorShell active={"courses"} live>
      <InstructorCourses />
    </InstructorShell>
  );
}
