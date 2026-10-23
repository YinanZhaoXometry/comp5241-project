import type { Metadata } from "next";
import { InstructorShell } from "../../shell/instructor-shell";
import { InstructorCourses } from "../../screens/instructor-courses";

export const metadata: Metadata = { title: "Instructor · Courses" };

export default function Page() {
  return (
    <InstructorShell active={"courses"}>
      <InstructorCourses />
    </InstructorShell>
  );
}
