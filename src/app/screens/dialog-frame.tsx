"use client";

// Native <dialog> frame for the LIVE instructor screens (epic-5 entry 1),
// extracted verbatim from the static instructors' DialogFrame: showModal()
// gives the keyboard contract (focus moves in, Tab trapped, Esc closes, top
// layer); backdrop clicks are wired via a listener in the effect and focus
// returns to the opener on any close.

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import st from "./instructor.module.css";

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

type DialogFrameProps = {
  labelId: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  fallbackFocusTo?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function DialogFrame({ labelId, onClose, returnFocusTo, fallbackFocusTo, children }: DialogFrameProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = returnFocusTo.current;
    const fallback = fallbackFocusTo?.current ?? null;
    dialog.showModal();
    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables.length > 0 ? focusables[0] : dialog).focus();
    function handleBackdropClick(event: MouseEvent) {
      if (event.target === dialog) onCloseRef.current();
    }
    function handleClose() {
      onCloseRef.current();
      if (opener && opener.isConnected) opener.focus();
      else if (fallback && fallback.isConnected) fallback.focus();
    }
    dialog.addEventListener("click", handleBackdropClick);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("click", handleBackdropClick);
      if (dialog.open) dialog.close();
      dialog.removeEventListener("close", handleClose);
    };
  }, [returnFocusTo, fallbackFocusTo]);

  return (
    <dialog ref={dialogRef} aria-labelledby={labelId} tabIndex={-1} className={st.dialogPanel}>
      {children}
    </dialog>
  );
}
