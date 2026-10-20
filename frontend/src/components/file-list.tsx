import type { StoredFile } from "@/types/file";
import { downloadUrl } from "@/lib/api";
import { formatDate, formatSize } from "@/lib/format";
import { Icon } from "./icons";

export function FileList({
  files,
  loading,
  error,
  onDelete,
  deletingId = null,
  actionsDisabled = false,
}: {
  files: StoredFile[];
  loading: boolean;
  error: boolean;
  onDelete?: (file: StoredFile) => void;
  deletingId?: number | null;
  actionsDisabled?: boolean;
}) {
  if (!files.length)
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="rounded-2xl bg-stone-100 p-4 text-stone-400">
          <Icon name="folder" width="32" height="32" />
        </span>
        <p className="font-medium text-stone-700">
          {loading
            ? "파일을 불러오고 있습니다"
            : error
              ? "파일 목록을 확인할 수 없습니다"
              : "아직 저장된 파일이 없습니다"}
        </p>
        <p className="text-sm text-stone-500">
          {error
            ? "서버 상태를 확인한 후 새로고침해 주세요."
            : loading
              ? "잠시만 기다려 주세요."
              : "위에서 첫 번째 파일을 업로드해 보세요."}
        </p>
      </div>
    );
  return (
    <div className="overflow-x-auto" aria-busy={loading}>
      <table className="w-full min-w-150 text-left text-sm">
        <caption className="sr-only">저장된 파일 목록</caption>
        <thead className="border-b border-stone-100 bg-stone-50/80 text-xs font-medium text-stone-500">
          <tr>
            <th scope="col" className="px-6 py-3">
              파일명
            </th>
            <th scope="col" className="px-4 py-3">
              크기
            </th>
            <th scope="col" className="px-4 py-3">
              업로드 시각 (한국)
            </th>
            <th scope="col" className="px-6 py-3 text-right">
              파일 관리
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {files.map((file) => (
            <tr key={file.id} className="transition hover:bg-stone-50">
              <td className="max-w-80 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg border border-stone-200 bg-white p-2 text-emerald-700">
                    <Icon name="file" />
                  </span>
                  <span
                    className="truncate font-medium text-stone-800"
                    title={file.filename}
                  >
                    {file.filename}
                  </span>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-stone-500">
                {formatSize(file.size)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-stone-500">
                {formatDate(file.uploaded_at)}
              </td>
              <td className="px-6 py-4 text-right">
                <a
                  href={downloadUrl(file.filename)}
                  download={file.filename}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 transition hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-800"
                  aria-label={`${file.filename} 다운로드`}
                >
                  <Icon name="download" width="16" height="16" />
                  <span>받기</span>
                </a>
                <button
                  type="button"
                  onClick={() => onDelete?.(file)}
                  disabled={
                    !onDelete ||
                    actionsDisabled ||
                    deletingId !== null ||
                    loading
                  }
                  aria-label={`${file.filename} 삭제`}
                  className="ml-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium whitespace-nowrap text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400"
                >
                  {deletingId === file.id ? "삭제 중…" : "삭제"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
