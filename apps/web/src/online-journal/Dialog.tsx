import { useEffect, useId, useRef, type ReactNode } from "react";

export function Dialog({
  title,
  locked,
  onClose,
  children,
}: {
  title: string;
  locked: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected && !trigger.matches(":disabled"))
        trigger.focus();
      else document.querySelector<HTMLElement>("[data-oj-heading]")?.focus();
    };
  }, []);
  return (
    <dialog
      className="oj-dialog oj-root"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const fields = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ),
        ].filter((field) => field.getClientRects().length);
        const first = fields[0],
          last = fields.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last!.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      <button
        type="button"
        className="oj-secondary"
        disabled={locked}
        onClick={onClose}
      >
        Отмена
      </button>
    </dialog>
  );
}
