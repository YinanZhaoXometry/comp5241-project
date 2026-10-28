"use client";

// Shared client session gate for the LIVE product surfaces (the epic-5
// instructor studio and the enrolled learner path). Mirrors the private
// tracer's session stance (study-app.tsx): the session is re-read from the
// server on an interval, a hidden tab clears private views, sign-in goes
// through Better Auth's rate-limited email endpoint, and failures surface the
// platform's stable error messages. No page-level secrets ever persist.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, json } from "./client";
import { errorCode, messages } from "../platform/errors";

export type LiveSession = { user: { id: string; name: string }; needsRefresh: boolean };

export function useSessionGate() {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const clear = useCallback(() => {
    generation.current += 1;
    setSession(null);
  }, []);
  const failure = useCallback(
    (error: unknown) => {
      const code = errorCode(error);
      if (code === "UNAUTHENTICATED") clear();
      setNotice(messages[code]);
    },
    [clear],
  );
  const load = useCallback(async () => {
    const stamp = generation.current;
    try {
      const current = await api<LiveSession | null>("auth/get-session");
      if (stamp !== generation.current) return;
      if (!current) {
        clear();
        return;
      }
      if (current.needsRefresh) await api("auth/get-session", json({}));
      if (stamp === generation.current) setSession(current);
    } catch (error) {
      if (stamp === generation.current) failure(error);
    } finally {
      if (stamp === generation.current) setReady(true);
    }
  }, [clear, failure]);
  useEffect(() => {
    const initial = setTimeout(() => {
      void load();
    }, 0);
    const timer = setInterval(() => {
      void load();
    }, 2000);
    const visible = () => {
      if (document.visibilityState === "hidden") clear();
      else void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load, clear]);
  const signIn = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setBusy(true);
      setNotice("");
      try {
        await api("auth/sign-in/email", json({ email: form.get("email"), password: form.get("password") }));
        await load();
      } catch (error) {
        failure(error);
      } finally {
        setBusy(false);
      }
    },
    [load, failure],
  );
  const signOut = useCallback(async () => {
    clear();
    setNotice("Signed out. Views cleared.");
    try {
      await api("auth/sign-out", json({}));
    } catch (error) {
      failure(error);
    }
  }, [clear, failure]);
  return { session, ready, notice, setNotice, busy, signIn, signOut, failure, reload: load };
}

// The operator-provisioned sign-in form (no public sign-up surface exists).
export function SignInPanel({
  busy,
  onSubmit,
  note,
}: Readonly<{ busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; note?: string }>) {
  return (
    <section aria-labelledby="live-signin-title">
      <h2 id="live-signin-title">Sign in</h2>
      <p>Use an operator-provisioned synthetic account. Public sign-up and self-promotion are unavailable.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required minLength={16} maxLength={128} />
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p>{note ?? "Contact the local operator for account access or recovery."}</p>
    </section>
  );
}
