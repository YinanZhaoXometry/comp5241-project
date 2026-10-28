import Link from "next/link";
import styles from "./shell.module.css";

export type InstructorSection = "courses" | "approvals" | "students" | "participation";

const navigation = [
  {
    section: "courses" as const,
    label: "Courses",
    href: "/instructor/courses",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    ),
  },
  {
    section: "approvals" as const,
    label: "Approvals",
    href: "/instructor/approvals",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
    ),
  },
  {
    section: "students" as const,
    label: "Students",
    href: "/instructor/students",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M17.5 15.3c2 .7 3.4 2.3 4 4.7" /></svg>
    ),
  },
  {
    section: "participation" as const,
    label: "Participation",
    href: "/instructor/participation",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 4-4 4 3 5-6" /></svg>
    ),
  },
];

export function InstructorShell({
  active,
  breadcrumb,
  live = false,
  children,
}: Readonly<{ active?: InstructorSection | null; breadcrumb?: string; live?: boolean; children: React.ReactNode }>) {
  const crumb = breadcrumb ?? (active ? `Instructor · ${navigation.find(item => item.section === active)?.label}` : "Instructor studio");
  // Live surfaces (epic-5 tracer) keep the honesty label but state it
  // accurately for live local data: synthetic sample data, no live AI.
  const honesty = live ? "Sample prototype · No live AI" : "Instructor sample · No live data";
  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#content">Skip to content</a>
      <nav className={styles.topnavMobile} aria-label="Primary">
        <Link className={styles.logo} href="/instructor/courses" prefetch={false}>Fieldnotes</Link>
        {navigation.map(item => (
          <Link key={item.section} href={item.href} prefetch={false} aria-current={active === item.section ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      <aside className={styles.sidebar}>
        <Link className={styles.logo} href="/instructor/courses" prefetch={false}>Fieldnotes</Link>
        <nav className={styles.sideNav} aria-label="Instructor studio">
          {navigation.map(item => (
            <Link key={item.section} href={item.href} prefetch={false} aria-current={active === item.section ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.sideStudy}>
          <p className={styles.listTitle}>Viewing as</p>
          <div className={styles.studyChip}>
            <span className={styles.sName}>Instructor</span>
            <span className={styles.sMeta}>{live ? "Signed-in principal · local synthetic" : "Prof. Rowan Ellis · sample"}</span>
          </div>
        </div>
        <nav className={`${styles.sideNav} ${styles.sideDivider}`} aria-label="Other views">
          <Link href="/library" prefetch={false}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
            Learner views
          </Link>
        </nav>
        <div className={styles.sideFoot}>{honesty}</div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.crumbMeta}>{crumb}{live ? " · Local synthetic data" : " · Sample data"}</span>
          <span className={styles.honestyPill}>{honesty}</span>
        </header>
        <main className={styles.content} id="content" tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.pagefoot}>
          {live
            ? <span>Fieldnotes · Local synthetic data only · No live AI, no real academic records behind these pages.</span>
            : <span>Fieldnotes · Original sample content · No academic records, AI generation or instructor approval behind these pages.</span>}
        </footer>
      </div>
    </div>
  );
}
