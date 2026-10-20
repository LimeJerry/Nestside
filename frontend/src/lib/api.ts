import type { StoredFile, UploadResult, DeleteResult } from "@/types/file";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(status: number, detail?: unknown): string {
  const known: Record<string, string> = {
    "File already exists":
      "같은 이름의 파일이 있습니다. 이름을 바꾼 뒤 다시 선택해 주세요.",
    "Another operation is using this filename":
      "같은 이름의 파일을 처리 중입니다. 잠시 후 목록을 새로고침해 주세요.",
    "Recovery required; contact administrator":
      "이 파일은 복구 확인이 필요합니다. 관리자에게 문의해 주세요.",
    "Invalid filename": "사용할 수 없는 파일명입니다.",
    "Unsafe stored filename": "사용할 수 없는 파일명입니다.",
  };
  if (typeof detail === "string" && known[detail]) return known[detail];
  if (status === 409)
    return "파일이 중복되거나 처리·복구 대기 상태입니다. 목록을 확인해 주세요.";
  if (status === 422) return "파일 요청 형식을 확인해 주세요.";
  if (status >= 500)
    return "서버 처리를 완료하지 못했습니다. 업로드했다면 재시도 전에 목록과 관리자 확인이 필요합니다.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 확인해 주세요.";
}

function isFile(value: unknown): value is StoredFile {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<StoredFile>;
  return (
    Number.isSafeInteger(f.id) &&
    typeof f.filename === "string" &&
    typeof f.size === "number" &&
    Number.isFinite(f.size) &&
    f.size >= 0 &&
    typeof f.sha256 === "string" &&
    typeof f.uploaded_at === "string" &&
    (f.content_type === null || typeof f.content_type === "string")
  );
}

export async function listFiles(signal?: AbortSignal): Promise<StoredFile[]> {
  let response: Response;
  try {
    response = await fetch("/api/files", { cache: "no-store", signal });
  } catch (error) {
    if (
      signal?.aborted ||
      (error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError")
    )
      throw error;
    throw new ApiError(
      0,
      "서버에 연결할 수 없습니다. 서버 상태를 확인하고 새로고침해 주세요.",
    );
  }
  if (!response.ok)
    throw new ApiError(response.status, errorMessage(response.status));
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      502,
      "파일 목록 응답을 읽지 못했습니다. 서버 상태를 확인해 주세요.",
    );
  }
  if (!Array.isArray(data) || !data.every(isFile))
    throw new ApiError(502, "파일 목록 응답 형식이 올바르지 않습니다.");
  return data;
}

export function downloadUrl(filename: string): string {
  return `/api/download/${encodeURIComponent(filename)}`;
}

export async function deleteFile(id: number): Promise<DeleteResult> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ApiError(400, "삭제할 파일 정보를 확인해 주세요.");
  const uncertain =
    "삭제 결과를 확인하지 못했습니다. 다시 삭제하기 전에 목록을 새로고침하고 관리자에게 확인해 주세요.";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    let response: Response;
    try {
      response = await fetch(`/api/files/${id}`, {
        method: "DELETE",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        0,
        controller.signal.aborted
          ? "응답 대기 시간이 지났습니다. 서버에서는 삭제가 계속 진행될 수 있습니다. 다시 삭제하기 전에 목록과 관리자 확인이 필요합니다."
          : uncertain,
      );
    }
    if (response.status === 403)
      throw new ApiError(
        403,
        "현재 서버에서는 파일 삭제가 비활성화되어 있습니다. 관리자에게 문의해 주세요.",
      );
    if (response.status === 404)
      throw new ApiError(
        404,
        "파일을 찾을 수 없습니다. 목록을 새로고침해 주세요.",
      );
    if (response.status === 409)
      throw new ApiError(
        409,
        "파일을 처리 중이거나 복구 확인이 필요합니다. 다시 삭제하기 전에 관리자에게 확인해 주세요.",
      );
    if (!response.ok) throw new ApiError(response.status, uncertain);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(502, uncertain);
    }
    if (
      !data ||
      typeof data !== "object" ||
      !("id" in data) ||
      data.id !== id ||
      !("status" in data) ||
      data.status !== "deleted" ||
      !("cleanup_pending" in data) ||
      typeof data.cleanup_pending !== "boolean"
    ) {
      throw new ApiError(502, uncertain);
    }
    return data as DeleteResult;
  } finally {
    clearTimeout(timeout);
  }
}

// File을 텍스트/ArrayBuffer/base64로 변환하지 않는다. 브라우저가 multipart를 전송한다.
export function uploadFile(
  file: File,
  onProgress: (percent: number | null) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/upload");
    request.responseType = "json";
    request.upload.onprogress = (event) =>
      onProgress(
        event.lengthComputable
          ? Math.round((event.loaded / event.total) * 100)
          : null,
      );
    request.onerror = () =>
      reject(
        new ApiError(
          0,
          "전송 결과를 확인할 수 없습니다. 재업로드 전에 목록을 새로고침해 주세요.",
        ),
      );
    request.onabort = () =>
      reject(
        new ApiError(
          0,
          "전송이 중단되었습니다. 재시도 전에 목록과 복구 상태를 확인해 주세요.",
        ),
      );
    request.onload = () => {
      const data = request.response;
      if (request.status < 200 || request.status >= 300) {
        reject(
          new ApiError(
            request.status,
            errorMessage(request.status, data?.detail),
          ),
        );
      } else if (
        !data ||
        data.status !== "uploaded" ||
        data.filename !== file.name ||
        data.size !== file.size
      ) {
        reject(
          new ApiError(
            502,
            "업로드 결과를 확인할 수 없습니다. 목록을 먼저 확인해 주세요.",
          ),
        );
      } else resolve(data as UploadResult);
    };
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}
