import type { Metadata } from "next";
import { InstructorShell } from "../../shell/instructor-shell";
import { InstructorStudents } from "../../screens/instructor-students";

export const metadata: Metadata = { title: "Instructor · Students" };

export default function Page() {
  return (
    <InstructorShell active={"students"}>
      <InstructorStudents />
    </InstructorShell>
  );
}
