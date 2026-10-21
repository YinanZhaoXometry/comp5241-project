import Link from "next/link";
import { DemoShell } from "./demo-shell";
import styles from "./demo.module.css";

export default function DemoNotFound() {
  return (
    <DemoShell active={null}>
      <p className={styles.overline}>A SMALL DETOUR · 404</p>
      <h1>Sample page not found</h1>
      <p className={styles.lead}>This prototype has four views: overview, lesson, practice and progress.</p>
      <Link className={styles.primary} href="/demo" prefetch={false}>Back to sample overview</Link>
    </DemoShell>
  );
}