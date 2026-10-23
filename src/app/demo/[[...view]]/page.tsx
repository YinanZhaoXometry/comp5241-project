import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoShell, type DemoView } from "../demo-shell";
import { Overview, Lesson, Progress } from "../sample-views";
import { Practice } from "../practice";
import { StartingCheck } from "../screens/starting-check";
import { CourseFull } from "../screens/course-full";
import { PracticeFull } from "../screens/practice-full";
import { TestRecovery } from "../screens/test-recovery";
import { Roadmap } from "../screens/roadmap";
import { ReviewInbox } from "../screens/review-inbox";
import { WhyExplorer } from "../screens/why-explorer";
import { PlanAi } from "../screens/plan-ai";
import { OwnerExport } from "../screens/owner-export";
import { SetupFlow } from "../screens/setup";
import { SystemStates } from "../screens/states";
import { InstructorCourses } from "../screens/instructor-courses";
import { InstructorApprovals } from "../screens/instructor-approvals";
import { InstructorStudents } from "../screens/instructor-students";
import { InstructorParticipation } from "../screens/instructor-participation";

type Props = { params: Promise<{ view?: string[] }> };

const views: Record<DemoView, () => React.ReactElement> = {
  overview: Overview,
  lesson: Lesson,
  practice: Practice,
  progress: Progress,
  "starting-check": StartingCheck,
  "course-full": CourseFull,
  "practice-full": PracticeFull,
  "test-recovery": TestRecovery,
  roadmap: Roadmap,
  "review-inbox": ReviewInbox,
  "why-explorer": WhyExplorer,
  "plan-ai": PlanAi,
  "owner-export": OwnerExport,
  setup: SetupFlow,
  states: SystemStates,
  "instructor-courses": InstructorCourses,
  "instructor-approvals": InstructorApprovals,
  "instructor-students": InstructorStudents,
  "instructor-participation": InstructorParticipation,
};

const titles: Record<DemoView, string> = {
  overview: "Overview",
  lesson: "Lesson",
  practice: "Practice",
  progress: "Progress",
  "starting-check": "Starting check",
  "course-full": "Course player · full",
  "practice-full": "Practice · full",
  "test-recovery": "Test & recovery",
  roadmap: "Roadmap",
  "review-inbox": "Review inbox",
  "why-explorer": "Why explorer",
  "plan-ai": "Plan · AI-assisted",
  "owner-export": "Owner export",
  setup: "Setup flow",
  states: "System states",
  "instructor-courses": "Instructor courses",
  "instructor-approvals": "Instructor approvals",
  "instructor-students": "Instructor students",
  "instructor-participation": "Instructor participation",
};

function resolveView(segments: string[] | undefined): DemoView | null {
  if (!segments?.length) return "overview";
  if (segments.length !== 1) return null;
  // Object.hasOwn, not `in`: /demo/constructor must stay a 404, and `in`
  // would match inherited Object.prototype properties.
  return Object.hasOwn(views, segments[0]) ? (segments[0] as DemoView) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = resolveView((await params).view);
  return { title: view ? titles[view] : "Page not found" };
}

export default async function DemoPage({ params }: Props) {
  const view = resolveView((await params).view);
  if (!view) notFound();
  const Screen = views[view];
  return (
    <DemoShell active={view} variant={view.startsWith("instructor-") ? "instructor" : "learner"}>
      <Screen />
    </DemoShell>
  );
}
