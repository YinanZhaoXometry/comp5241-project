import type { Metadata } from "next";
import { InstructorShell } from "../../shell/instructor-shell";
import { InstructorApprovals } from "../../screens/instructor-approvals";

export const metadata: Metadata = { title: "Instructor · Approvals" };

// LIVE instructor route (epic-5 entry 1): the exact-version approval inspector
// over the signed-in instructor's real pending drafts and approval records.
export default function Page() {
  return (
    <InstructorShell active={"approvals"} live>
      <InstructorApprovals />
    </InstructorShell>
  );
}
