import { describe, it, expect, vi } from "vitest";
import { listFiles, downloadUrl, uploadFile } from "@/lib/api";
const file = {
  id: 1,
  filename: "예시.txt",
  size: 3,
  sha256: "abc",
  content_type: "text/plain",
  uploaded_at: "2026-10-20T00:00:00Z",
};

describe("목록과 다운로드 API", () => {
  it("상대 경로와 캐시 비활성화로 목록을 조회한다", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [file] });
    vi.stubGlobal("fetch", fetch);
    expect(await listFiles()).toEqual([file]);
    expect(fetch).toHaveBeenCalledWith("/api/files", {
      cache: "no-store",
      signal: undefined,
    });
  });
  it("잘못된 목록 응답을 거부한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ ...file, size: -1 }],
      }),
    );
    await expect(listFiles()).rejects.toThrow("응답 형식");
  });
  it("JSON이 아닌 응답도 한국어로 안내한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("not JSON");
        },
      }),
    );
    await expect(listFiles()).rejects.toThrow("목록 응답을 읽지 못했습니다");
  });
  it("서버 오류를 한국어로 안내한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    await expect(listFiles()).rejects.toThrow("서버");
  });
  it("네트워크 오류를 안내한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(listFiles()).rejects.toThrow("연결");
  });
  it("취소를 일반 서버 오류로 바꾸지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")),
    );
    await expect(listFiles()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("한글과 경로 구분 문자를 인코딩한다", () => {
    expect(downloadUrl("한글 #?%&.txt")).toBe(
      `/api/download/${encodeURIComponent("한글 #?%&.txt")}`,
    );
    expect(downloadUrl("../x")).toBe("/api/download/..%2Fx");
  });
});

class MockXHR {
  static last: MockXHR;
  constructor() {
    MockXHR.last = this;
  }
  upload: {
    onprogress?: (event: {
      lengthComputable: boolean;
      loaded: number;
      total: number;
    }) => void;
  } = {};
  status = 200;
  response: unknown;
  responseType = "";
  onload = () => {};
  onerror = () => {};
  onabort = () => {};
  open = vi.fn();
  send = vi.fn();
}

describe("업로드 전송", () => {
  function start() {
    vi.stubGlobal("XMLHttpRequest", MockXHR);
    const upload = new File(["abc"], "예시.txt");
    const progress = vi.fn();
    return {
      result: uploadFile(upload, progress),
      xhr: MockXHR.last,
      upload,
      progress,
    };
  }
  it("File을 그대로 FormData의 file 필드로 전송한다", async () => {
    const { result, xhr, upload } = start();
    expect(xhr.open).toHaveBeenCalledWith("POST", "/api/upload");
    const body = xhr.send.mock.calls[0][0] as FormData;
    expect(body.get("file")).toBe(upload);
    xhr.response = { ...file, status: "uploaded" };
    xhr.onload();
    expect((await result).status).toBe("uploaded");
  });
  it("진행률을 전달한다", async () => {
    const { result, xhr, progress } = start();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    expect(progress).toHaveBeenCalledWith(50);
    xhr.response = { ...file, status: "uploaded" };
    xhr.onload();
    await result;
  });
  it.each(["File already exists", "Recovery required; contact administrator"])(
    "충돌을 자동 재시도하지 않는다: %s",
    async (detail) => {
      const { result, xhr } = start();
      xhr.status = 409;
      xhr.response = { detail };
      xhr.onload();
      await expect(result).rejects.toMatchObject({ status: 409 });
      expect(xhr.send).toHaveBeenCalledTimes(1);
    },
  );
  it("네트워크 단절 시 결과 불확실성을 안내한다", async () => {
    const { result, xhr } = start();
    xhr.onerror();
    await expect(result).rejects.toThrow("재업로드 전에");
  });
  it("잘못된 성공 응답을 성공으로 처리하지 않는다", async () => {
    const { result, xhr } = start();
    xhr.response = { status: "uploaded", filename: "other.txt", size: 3 };
    xhr.onload();
    await expect(result).rejects.toThrow("목록을 먼저");
  });
});
