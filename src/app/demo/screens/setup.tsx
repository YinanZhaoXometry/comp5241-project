import { Fragment } from "react";
import Link from "next/link";
import kit from "../../kit.module.css";
import sys from "./system-screens.module.css";

type LifecycleStatus = "designed" | "spine-only";

type LifecycleLink = {
  href: string;
  label: string;
  /** Marks cards whose built counterpart is the real local tracer at "/" —
   the link carries the tracer honesty note instead of a sample route. */
  tracerNote?: boolean;
};

type LifecycleState = {
  id: string;
  title: string;
  status: LifecycleStatus;
  sees: string;
  honesty: string;
  link?: LifecycleLink;
};

// U0–U8 from the experience spine, ported from the reference setup-flow
// design artifact. Cards link to the demo routes that exist now; U0 and U5
// link into the real local tracer, which carries its own honesty label.
// Fixed sample copy only — nothing here is fetched or stored.
const LIFECYCLE: readonly LifecycleState[] = [
  {
    id: "U0",
    title: "Signed out",
    status: "designed",
    sees: "The sign-in card: email field, one continue button, and a sample-workspace link. No marketing panel.",
    honesty: "The sample states plainly that no account is created and no email is sent.",
    link: { href: "/", label: "Open sign-in ↗", tracerNote: true },
  },
  {
    id: "U1",
    title: "Creating account",
    status: "spine-only",
    sees: "A short pending state after submitting the email — “setting up your workspace” — with no spinner theater beyond what the task actually takes.",
    honesty: "If creation takes longer than a few seconds, the copy says so instead of looping a fake animation.",
  },
  {
    id: "U2",
    title: "First sign-in",
    status: "spine-only",
    sees: "A plain welcome: what Fieldnotes does, in two sentences, and where to start. No tour, no feature carousel.",
    honesty: "The welcome names the AI boundary up front — it reads only the materials you upload.",
  },
  {
    id: "U3",
    title: "Empty library",
    status: "designed",
    sees: "“No saved studies yet” with one quiet call to create the first study. Nothing is padded with demo content to look alive.",
    honesty: "An empty library is stated as a fact, and the empty state pattern lives in the system-states gallery.",
    link: { href: "/demo", label: "Open library" },
  },
  {
    id: "U4",
    title: "First study setup",
    status: "designed",
    sees: "Upload materials, confirm the goal and plan the AI drafted, then start. Nothing is scheduled until the learner confirms.",
    honesty: "The plan is shown before it is run — the learner approves the goal, not just the upload.",
    link: { href: "/demo/plan-ai", label: "Open study setup" },
  },
  {
    id: "U5",
    title: "Privacy consent",
    status: "designed",
    sees: "The AI-processing consent panel: what is read, what is sent, and what stays local — in plain language, before the first generation.",
    honesty: "Consent is a real gate, not a banner: the study does not start until the learner has read and chosen.",
    link: { href: "/", label: "Open privacy & data ↗", tracerNote: true },
  },
  {
    id: "U6",
    title: "Optional starting check",
    status: "designed",
    sees: "Three self-rating questions — not a test — that suggest a starting lesson. Skipping is a first-class choice, shown as clearly as continuing.",
    honesty: "The result is a suggestion with the reasoning attached; the learner decides, and can redo it later.",
    link: { href: "/demo/starting-check", label: "Open starting check" },
  },
  {
    id: "U7",
    title: "Export",
    status: "designed",
    sees: "A settings panel listing exactly what an export contains and its format, with a prepare-then-download flow.",
    honesty: "In the sample the export is simulated and says so; in product, export is a standing right, not a retention hurdle.",
    link: { href: "/demo/owner-export", label: "Open export & deletion" },
  },
  {
    id: "U8",
    title: "Deletion receipt",
    status: "designed",
    sees: "After a two-step confirm, a quiet receipt: what was deleted, when, and a reference code. No guilt copy, no “we’ll miss you”.",
    honesty: "The receipt is the only confirmation — deletion cannot be undone, and the copy says exactly that.",
    link: { href: "/demo/owner-export", label: "Open export & deletion" },
  },
];

export function SetupFlow() {
  return (
    <div className={sys.setup}>
      <header className={sys.flowHead}>
        <h1 className={sys.flowTitle}>Setup &amp; lifecycle flow</h1>
        <p className={sys.flowSub}>
          The nine account-lifecycle states from the experience spine, U0 through U8, in the order a learner
          meets them. Cards link to the built screen where one exists.
        </p>
        <p className={sys.scopeNote}>
          This page is a design artifact — it maps the flow; it is not itself a product screen. All copy shown
          is sample copy.
        </p>
      </header>
      <div className={sys.flow}>
        {LIFECYCLE.map((state, index) => (
          <Fragment key={state.id}>
            {index > 0 && <div className={sys.stateConnector} aria-hidden="true" />}
            <article className={sys.stateCard}>
              <div className={sys.stateTop}>
                <span className={sys.stateId}>{state.id}</span>
                <span className={state.status === "designed" ? kit.pillSuccess : kit.pillMuted}>
                  <span className={kit.dot} aria-hidden="true" />
                  {state.status === "designed" ? "Designed" : "Spine-only"}
                </span>
              </div>
              <h2 className={sys.stateTitle}>{state.title}</h2>
              <p className={sys.sees}>
                <span className={sys.seesLabel}>What the learner sees</span>
                {state.sees}
              </p>
              <p className={sys.honesty}>
                <span className={sys.honestyLabel}>Honesty note</span>
                {state.honesty}
              </p>
              {state.link ? (
                <div>
                  <Link className={sys.stateLink} href={state.link.href} prefetch={false}>
                    {state.link.label}
                  </Link>
                  {state.link.tracerNote ? (
                    <p className={sys.stateTrace}>Local tracer — not approved for real data.</p>
                  ) : null}
                </div>
              ) : (
                <span className={sys.stateNolink}>No designed screen in this sample yet.</span>
              )}
            </article>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
