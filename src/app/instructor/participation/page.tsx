import type { Metadata } from "next";
import { InstructorShell } from "../../shell/instructor-shell";
import { InstructorParticipation } from "../../screens/instructor-participation";

export const metadata: Metadata = { title: "Instructor · Participation" };

export default function Page() {
  return (
    <InstructorShell active={"participation"}>
      <InstructorParticipation />
    </InstructorShell>
  );
}
