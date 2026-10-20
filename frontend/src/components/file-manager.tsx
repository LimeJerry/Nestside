"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { StoredFile } from "@/types/file";
import { listFiles, uploadFile, deleteFile } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { FileList } from "./file-list";
import { UploadPanel } from "./upload-panel";
import { StatusMessage } from "./status-message";
import { Icon } from "./icons";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

export function FileManager() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const active = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const removing = useRef(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredFile | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const focusRefresh = useCallback(() => refreshButton.current?.focus(), []);
  const load = useCallback(async (controller: AbortController) => {
    try {
      const data = await listFiles(controller.signal);
      if (!controller.signal.aborted) setFiles(data);
    } catch (error) {
      if (!controller.signal.aborted)
        setListError(
          error instanceof Error
            ? error.message
            : "파일 목록을 불러오지 못했습니다.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  const refresh = useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setListError("");
    return load(controller);
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    listFiles(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFiles(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setListError(
            error instanceof Error
              ? error.message
              : "파일 목록을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function upload(file: File) {
    if (sending.current || removing.current || deleteTarget) return false;
    sending.current = true;
    setUploading(true);
    setProgress(null);
    setNotice(null);
    try {
      await uploadFile(file, setProgress);
      setNotice({ message: `${file.name} 파일을 업로드했습니다.` });
      await refresh();
      return true;
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "업로드 결과를 확인할 수 없습니다.",
        error: true,
      });
      return false;
    } finally {
      sending.current = false;
      setUploading(false);
    }
  }
  function askDelete(file: StoredFile) {
    if (
      sending.current ||
      removing.current ||
      loading ||
      listError ||
      deleteTarget
    )
      return;
    setDeleteTarget(file);
  }
  async function confirmDelete() {
    if (!deleteTarget || sending.current || removing.current) return;
    const target = deleteTarget;
    removing.current = true;
    setDeletingId(target.id);
    setNotice(null);
    active.current?.abort();
    try {
      const result = await deleteFile(target.id);
      setFiles((current) => current.filter((file) => file.id !== target.id));
      setNotice({
        message: result.cleanup_pending
          ? `${target.filename} 파일을 목록에서 삭제했습니다. 서버에 임시 파일 정리가 남아 있어 관리자 확인이 필요합니다.`
          : `${target.filename} 파일을 삭제했습니다.`,
      });
      await refresh();
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "삭제 결과를 확인하지 못했습니다. 다시 삭제하기 전에 목록과 관리자 확인이 필요합니다.",
        error: true,
      });
    } finally {
      removing.current = false;
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }
  return (
    <div className="min-h-screen bg-[#f7f8f5] text-stone-800">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="Nestside 홈"
          >
            <span className="rounded-xl bg-[#244f43] p-2.5 text-white">
              <Icon name="home" width="23" height="23" />
            </span>
            <span className="text-2xl font-semibold tracking-tight">
              nestside<span className="text-emerald-700">.</span>
            </span>
          </Link>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-500">
            개인 클라우드 <span className="ml-2 text-stone-300">/</span>
            <span className="ml-2 font-medium text-stone-600">v0.1</span>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-12 pt-9 sm:px-8 sm:pt-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-emerald-800">
              나만의 파일 공간
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              나의 파일 보관함
            </h1>
            <p className="mt-3 text-sm leading-6 text-stone-500">
              소중한 파일을 한곳에. 내 서버에서 간편하게 관리하세요.
            </p>
          </div>
          <span className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            내부망 개발용 · 인증 미적용
          </span>
        </div>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white px-6 py-5">
            <span className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
              <Icon name="folder" width="24" height="24" />
            </span>
            <div>
              <p className="text-xs text-stone-500">목록의 파일</p>
              <p className="mt-1 text-2xl font-semibold">
                {loading && !files.length ? "—" : files.length}
                <span className="ml-1.5 text-sm font-normal text-stone-400">
                  개
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white px-6 py-5">
            <span className="rounded-xl bg-stone-100 p-3 text-stone-600">
              <Icon name="file" width="24" height="24" />
            </span>
            <div>
              <p className="text-xs text-stone-500">목록의 전체 용량</p>
              <p className="mt-1 text-2xl font-semibold">
                {loading && !files.length
                  ? "—"
                  : formatSize(files.reduce((sum, file) => sum + file.size, 0))}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-5">
          <UploadPanel
            uploading={uploading}
            progress={progress}
            onUpload={upload}
            disabled={deleteTarget !== null || deletingId !== null}
          />
          {notice && <StatusMessage {...notice} />}
          {listError && <StatusMessage message={listError} error />}
          <section
            aria-labelledby="files-title"
            className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-5">
              <div className="flex items-center gap-3">
                <h2 id="files-title" className="font-semibold">
                  모든 파일
                </h2>
                <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                  {files.length}
                </span>
              </div>
              <button
                ref={refreshButton}
                type="button"
                onClick={() => void refresh()}
                disabled={loading || deletingId !== null}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  width="15"
                  height="15"
                  className={loading ? "animate-spin" : ""}
                />
                새로고침
              </button>
            </div>
            {listError && files.length > 0 && (
              <p className="px-6 pt-3 text-xs text-amber-800">
                마지막으로 확인한 목록입니다. 최신 상태는 새로고침이 필요합니다.
              </p>
            )}
            <FileList
              files={files}
              loading={loading}
              error={!!listError}
              onDelete={askDelete}
              deletingId={deletingId}
              actionsDisabled={uploading || !!listError}
            />
          </section>
        </div>
        <footer className="mt-7 flex flex-wrap justify-between gap-2 text-xs leading-5 text-stone-400">
          <span>Nestside · 나만의 작은 클라우드</span>
          <span>파일은 연결된 개인 서버에 저장됩니다.</span>
        </footer>
      </main>
      {deleteTarget && (
        <DeleteConfirmDialog
          file={deleteTarget}
          busy={deletingId !== null}
          onCancel={() => {
            if (!removing.current) setDeleteTarget(null);
          }}
          onConfirm={() => void confirmDelete()}
          fallbackFocus={focusRefresh}
        />
      )}
    </div>
  );
}
