"use client";
import { useRef, useState } from "react";
import { formatSize } from "@/lib/format";
import { Icon } from "./icons";

export function UploadPanel({
  uploading,
  progress,
  onUpload,
  disabled = false,
}: {
  uploading: boolean;
  progress: number | null;
  onUpload: (file: File) => Promise<boolean>;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const blocked = uploading || disabled;
  function select(files: FileList | null) {
    if (!files || blocked) return;
    if (files.length !== 1) {
      setSelectionError("파일은 한 번에 하나씩 선택해 주세요.");
      return;
    }
    setSelectionError("");
    setFile(files[0]);
  }
  async function submit() {
    if (!blocked && file && (await onUpload(file))) {
      setFile(null);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section
      aria-labelledby="upload-title"
      className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6"
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 id="upload-title" className="font-semibold text-stone-800">
          파일 업로드
        </h2>
        <span className="text-xs text-stone-400">
          나의 서버에 안전하게 보관
        </span>
      </div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!blocked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          select(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-4 rounded-xl border border-dashed px-5 py-7 transition sm:flex-row sm:px-7 ${dragging ? "border-emerald-600 bg-emerald-50" : "border-stone-300 bg-stone-50/60"}`}
      >
        <span className="rounded-xl border border-stone-200 bg-white p-3 text-emerald-800">
          <Icon name="upload" width="24" height="24" />
        </span>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="truncate font-medium text-stone-700">
            {file ? file.name : "파일을 여기에 놓거나 선택해 주세요"}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            {file
              ? `${formatSize(file.size)} · 업로드할 준비가 되었습니다`
              : "문서, 이미지 등 파일을 한 번에 하나씩 업로드할 수 있습니다."}
          </p>
        </div>
        <input
          ref={input}
          type="file"
          id="file-picker"
          aria-label="업로드할 파일 선택"
          disabled={blocked}
          onChange={(event) => select(event.target.files)}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={blocked}
          className="button-secondary"
        >
          파일 선택
        </button>
      </div>
      {selectionError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {selectionError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs leading-5 text-stone-400">
          같은 이름의 파일은 덮어쓰지 않습니다.
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!file || blocked}
          className="button-primary"
        >
          <Icon name="upload" width="16" height="16" />
          {uploading ? "업로드 중…" : "업로드"}
        </button>
      </div>
      {uploading && (
        <div className="mt-4" role="status">
          <p className="mb-2 text-xs text-emerald-800">
            {progress === 100
              ? "전송 완료 · 서버 저장 결과를 확인하고 있습니다…"
              : `파일을 전송하고 있습니다${progress === null ? "…" : ` · ${progress}%`}`}
          </p>
          <progress
            max="100"
            value={progress ?? undefined}
            className="h-1.5 w-full accent-emerald-700"
            aria-label="파일 전송 진행률"
          />
        </div>
      )}
    </section>
  );
}
