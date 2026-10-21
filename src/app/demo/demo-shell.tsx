import Link from "next/link";
import styles from "./demo.module.css";

export type DemoView = "overview" | "lesson" | "practice" | "progress";
const navigation = [
  { view: "overview", label: "Overview", href: "/demo", mark: "01" },
  { view: "lesson", label: "Lesson", href: "/demo/lesson", mark: "02" },
  { view: "practice", label: "Practice", href: "/demo/practice", mark: "03" },
  { view: "progress", label: "Progress", href: "/demo/progress", mark: "04" },
] as const;

export function DemoShell({ active, children }: Readonly<{ active: DemoView | null; children: React.ReactNode }>) {
  return (
    <div className={styles.demo}>
      <a className={styles.skip} href="#sample-content">Skip to sample content</a>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/demo" prefetch={false} aria-label="Fieldnotes sample overview">
          <svg viewBox="0 0 32 36" width="28" height="32" aria-hidden="true"><path d="M4 3h24v30H4zM11 3v30M16 11h7M16 17h7M16 23h4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          <span>Fieldnotes<span className={styles.brandCaption}>A LITTLE MORE UNDERSTOOD.</span></span>
        </Link>
        <p className={styles.navLabel}>YOUR STUDY SPACE</p>
        <nav aria-label="Sample study" className={styles.nav}>
          {navigation.map(item => (
            <Link key={item.view} href={item.href} prefetch={false} aria-current={active === item.view ? "page" : undefined}>
              <span className={styles.navNumber} aria-hidden="true">{item.mark}</span>{item.label}
              {active === item.view && <span className={styles.navArrow} aria-hidden="true">↗</span>}
            </Link>
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
          <span>Learning lab <span aria-hidden="true">/</span> Unit testing</span>
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