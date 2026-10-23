import type { Metadata } from "next";
import { InstructorShell } from "../../shell/instructor-shell";
import { InstructorApprovals } from "../../screens/instructor-approvals";

export const metadata: Metadata = { title: "Instructor · Approvals" };

export default function Page() {
  return (
    <InstructorShell active={"approvals"}>
      <InstructorApprovals />
    </InstructorShell>
  );
}
