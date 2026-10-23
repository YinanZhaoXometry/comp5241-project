import Link from "next/link";
import { DemoShell } from "./demo-shell";
import styles from "./demo.module.css";

export default function DemoNotFound() {
  return (
    <DemoShell active={null}>
      <div className={styles.pageHeading}>
        <p className={styles.overline}>A SMALL DETOUR · 404</p>
        <h1>Sample page not found</h1>
        <p className={styles.lead}>
          The sample has grown past its four original views: overview, lesson,
          practice and progress are joined by early product screens.
        </p>
        <Link className={styles.primary} href="/demo" prefetch={false}>Back to sample overview</Link>
      </div>
    </DemoShell>
  );
}
