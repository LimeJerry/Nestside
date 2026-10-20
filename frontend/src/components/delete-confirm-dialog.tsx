"use client";
import { useEffect, useRef } from "react";
import type { StoredFile } from "@/types/file";

export function DeleteConfirmDialog({
  file,
  busy,
  onCancel,
  onConfirm,
  fallbackFocus,
}: {
  file: StoredFile;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  fallbackFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
      else fallbackFocus();
    };
  }, [fallbackFocus]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-title"
      aria-describedby="delete-filename delete-warning"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        );
        if (!buttons?.length) {
          event.preventDefault();
          return;
        }
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        // 브라우저 주소창으로 초점이 빠지지 않도록 대화상자 안에서 순환한다.
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-6 text-stone-800 shadow-xl backdrop:bg-stone-900/40"
    >
      <h2 id="delete-title" className="text-xl font-semibold">
        파일을 삭제할까요?
      </h2>
      <p
        id="delete-filename"
        className="mt-4 max-h-48 overflow-y-auto rounded-xl bg-stone-100 p-4 font-medium break-all"
      >
        {file.filename}
      </p>
      <p id="delete-warning" className="mt-4 text-sm leading-6 text-stone-600">
        이 작업은 실제 파일을 삭제합니다. 삭제 후 복구가 보장되지 않습니다.
        삭제할 파일이 맞는지 확인해 주세요.
      </p>
      {busy && (
        <p role="status" className="mt-4 text-sm text-stone-600">
          삭제 결과를 확인하고 있습니다. 잠시만 기다려 주세요.
        </p>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button
          ref={cancel}
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="button-secondary"
        >
          취소
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
        >
          {busy ? "삭제 중…" : "삭제하기"}
        </button>
      </div>
    </dialog>
  );
}
