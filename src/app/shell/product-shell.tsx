import Link from "next/link";
import styles from "./shell.module.css";

export type ProductSection = "library" | "new-study" | "review" | "roadmap" | "progress" | "data";

const navigation = [
  {
    section: "library" as const,
    label: "Library",
    href: "/library",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    ),
  },
  {
    section: "new-study" as const,
    label: "New study",
    href: "/",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    ),
  },
  {
    section: "review" as const,
    label: "Review inbox",
    href: "/review",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
    ),
  },
  {
    section: "roadmap" as const,
    label: "Roadmap",
    href: "/roadmap",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.2 17.4 15.8 6.6" /></svg>
    ),
  },
  {
    section: "progress" as const,
    label: "Progress",
    href: "/progress",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 14 4-4 4 3 5-6" /></svg>
    ),
  },
  {
    section: "data" as const,
    label: "Privacy & data",
    href: "/data",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
    ),
  },
];

export function ProductShell({
  active,
  breadcrumb,
  children,
}: Readonly<{ active?: ProductSection | null; breadcrumb?: string; children: React.ReactNode }>) {
  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#content">Skip to content</a>
      <nav className={styles.topnavMobile} aria-label="Primary">
        <Link className={styles.logo} href="/library" prefetch={false}>Fieldnotes</Link>
        {navigation.map(item => (
          <Link key={item.section} href={item.href} prefetch={false} aria-current={active === item.section ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      <aside className={styles.sidebar}>
        <Link className={styles.logo} href="/library" prefetch={false}>Fieldnotes</Link>
        <nav className={styles.sideNav} aria-label="Primary">
          {navigation.map(item => (
            <Link key={item.section} href={item.href} prefetch={false} aria-current={active === item.section ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          Sample prototype · No live AI
          <br />
          Local tracer — not approved for real data
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.crumbMeta}>{breadcrumb ?? "Fieldnotes"}</span>
          <span className={styles.honestyPill}>Sample prototype · No live AI</span>
        </header>
        <main className={styles.content} id="content" tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.pagefoot}>
          <span>Fieldnotes · Original sample content · No academic records, AI generation or instructor approval behind these pages.</span>
        </footer>
      </div>
    </div>
  );
}
