import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoShell, type DemoView } from "../demo-shell";
import { Overview, Lesson, Progress } from "../sample-views";
import { Practice } from "../practice";

type Props = { params: Promise<{ view?: string[] }> };

function resolveView(segments: string[] | undefined): DemoView | null {
  if (!segments?.length) return "overview";
  if (segments.length !== 1) return null;
  const view = segments[0];
  return view === "lesson" || view === "practice" || view === "progress" ? view : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = resolveView((await params).view);
  return { title: view ? view.charAt(0).toUpperCase() + view.slice(1) : "Page not found" };
}

export default async function DemoPage({ params }: Props) {
  const view = resolveView((await params).view);
  if (!view) notFound();
  return (
    <DemoShell active={view}>
      {view === "overview" && <Overview />}
      {view === "lesson" && <Lesson />}
      {view === "practice" && <Practice />}
      {view === "progress" && <Progress />}
    </DemoShell>
  );
}