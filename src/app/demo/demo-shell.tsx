import Link from "next/link";
import styles from "./demo.module.css";

export type DemoView =
  | "overview"
  | "lesson"
  | "practice"
  | "progress"
  | "starting-check"
  | "course-full"
  | "practice-full"
  | "test-recovery"
  | "roadmap"
  | "review-inbox"
  | "why-explorer"
  | "plan-ai"
  | "owner-export"
  | "setup"
  | "states"
  | "instructor-courses"
  | "instructor-approvals"
  | "instructor-students"
  | "instructor-participation";

type NavItem = { view: DemoView; label: string; href: string; mark: string };
type NavGroup = { label: string; items: readonly NavItem[] };

const learnerNav: readonly NavGroup[] = [
  {
    label: "YOUR STUDY SPACE",
    items: [
      { view: "overview", label: "Overview", href: "/demo", mark: "01" },
      { view: "lesson", label: "Lesson", href: "/demo/lesson", mark: "02" },
      { view: "practice", label: "Practice", href: "/demo/practice", mark: "03" },
      { view: "progress", label: "Progress", href: "/demo/progress", mark: "04" },
    ],
  },
  {
    label: "PRODUCT SCREENS",
    items: [
      { view: "starting-check", label: "Starting check", href: "/demo/starting-check", mark: "05" },
      { view: "course-full", label: "Course player · full", href: "/demo/course-full", mark: "06" },
      { view: "practice-full", label: "Practice · full", href: "/demo/practice-full", mark: "07" },
      { view: "test-recovery", label: "Test & recovery", href: "/demo/test-recovery", mark: "08" },
      { view: "roadmap", label: "Roadmap", href: "/demo/roadmap", mark: "09" },
      { view: "review-inbox", label: "Review inbox", href: "/demo/review-inbox", mark: "10" },
      { view: "why-explorer", label: "Why explorer", href: "/demo/why-explorer", mark: "11" },
      { view: "plan-ai", label: "Plan · AI-assisted", href: "/demo/plan-ai", mark: "12" },
      { view: "owner-export", label: "Owner export", href: "/demo/owner-export", mark: "13" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { view: "setup", label: "Setup flow", href: "/demo/setup", mark: "14" },
      { view: "states", label: "System states", href: "/demo/states", mark: "15" },
    ],
  },
];

const instructorNav: readonly NavGroup[] = [
  {
    label: "INSTRUCTOR STUDIO",
    items: [
      { view: "instructor-courses", label: "Courses", href: "/demo/instructor-courses", mark: "01" },
      { view: "instructor-approvals", label: "Approvals", href: "/demo/instructor-approvals", mark: "02" },
      { view: "instructor-students", label: "Students", href: "/demo/instructor-students", mark: "03" },
      { view: "instructor-participation", label: "Participation", href: "/demo/instructor-participation", mark: "04" },
    ],
  },
  {
    label: "STUDY SAMPLE",
    items: [
      { view: "overview", label: "Overview", href: "/demo", mark: "01" },
      { view: "lesson", label: "Lesson", href: "/demo/lesson", mark: "02" },
      { view: "practice", label: "Practice", href: "/demo/practice", mark: "03" },
      { view: "progress", label: "Progress", href: "/demo/progress", mark: "04" },
    ],
  },
];

export function DemoShell({
  active,
  variant = "learner",
  breadcrumb,
  children,
}: Readonly<{ active: DemoView | null; variant?: "learner" | "instructor"; breadcrumb?: string; children: React.ReactNode }>) {
  const groups = variant === "instructor" ? instructorNav : learnerNav;
  const crumb = breadcrumb ?? (variant === "instructor" ? "Instructor studio / Sample data" : "Learning lab / Unit testing");
  return (
    <div className={styles.demo}>
      <a className={styles.skip} href="#sample-content">Skip to sample content</a>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/demo" prefetch={false} aria-label="Fieldnotes sample overview">
          <svg viewBox="0 0 32 36" width="28" height="32" aria-hidden="true"><path d="M4 3h24v30H4zM11 3v30M16 11h7M16 17h7M16 23h4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          <span>Fieldnotes<span className={styles.brandCaption}>A LITTLE MORE UNDERSTOOD.</span></span>
        </Link>
        <nav
          aria-label={variant === "instructor" ? "Instructor studio" : "Sample study"}
          className={styles.nav}
        >
          {groups.map(group => (
            <div key={group.label} className={styles.navGroup}>
              <span className={styles.navLabel}>{group.label}</span>
              {group.items.map(item => (
                <Link key={item.href + item.label} href={item.href} prefetch={false} aria-current={active === item.view ? "page" : undefined}>
                  <span className={styles.navNumber} aria-hidden="true">{item.mark}</span>{item.label}
                  {active === item.view && <span className={styles.navArrow} aria-hidden="true">↗</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarNote}>
          <span className={styles.overline}>THE IDEA</span>
          <p>Not more content.<br />More moments of clarity.</p>
          <span className={styles.muted}>Learn a little. Try it out. Find the gap. Come back stronger.</span>
        </div>
        <div className={styles.sidebarBottom}>
          <span className={styles.overline}>COMP5241 · POLYU</span>
          <p>Software engineering,<br />one useful idea at a time.</p>
          <Link href="/" prefetch={false}>Open private study tracer ↗</Link>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <span>{crumb}</span>
          <span className={styles.sampleBadge}>Sample prototype · No live AI</span>
        </header>
        <main id="sample-content" tabIndex={-1} className={styles.main}>
          {children}
          <footer className={styles.footer}>
            <span>Original sample content. No academic records, AI generation or instructor approval.</span>
            <span>AI Fluency 4D · A presentation lens, not an implemented assessment.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
