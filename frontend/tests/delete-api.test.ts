import { it, expect, vi } from "vitest";
import { deleteFile } from "@/lib/api";

function mockResponse(status: number, data: unknown) {
  const fetch = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => data,
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it.each([false, true])(
  "파일 ID와 정리 대기 여부를 확인한다: %s",
  async (pending) => {
    const data = { id: 7, status: "deleted", cleanup_pending: pending };
    const fetch = mockResponse(200, data);
    expect(await deleteFile(7)).toEqual(data);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/files/7", {
      method: "DELETE",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  },
);
it.each([
  [403, "비활성화"],
  [404, "찾을 수 없습니다"],
  [409, "복구 확인"],
  [500, "삭제 결과"],
])("삭제 오류 %s를 한국어로 안내한다", async (status, message) => {
  const fetch = mockResponse(Number(status), { detail: "테스트 오류" });
  await expect(deleteFile(7)).rejects.toThrow(String(message));
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("연결 단절 시 삭제를 자동 재시도하지 않는다", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("테스트 연결 단절"));
  vi.stubGlobal("fetch", fetch);
  await expect(deleteFile(7)).rejects.toThrow("다시 삭제하기 전에");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  { id: 8, status: "deleted", cleanup_pending: false },
  { id: 7, status: "uploaded", cleanup_pending: false },
  { id: 7, status: "deleted" },
  null,
])("확인되지 않은 성공 응답을 거부한다: %j", async (data) => {
  mockResponse(200, data);
  await expect(deleteFile(7)).rejects.toMatchObject({ status: 502 });
});
it("성공 응답이 JSON이 아니면 확인을 요청한다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError("테스트 응답 오류");
      },
    }),
  );
  await expect(deleteFile(7)).rejects.toThrow("삭제 결과");
});
it.each([0, -1, 1.5, NaN])("잘못된 ID는 전송하지 않는다: %s", async (id) => {
  const fetch = mockResponse(200, {});
  await expect(deleteFile(id)).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});

it("응답이 없으면 대기를 끝내고 서버 결과 확인을 요청한다", async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("대기 시간 초과", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const checked = expect(deleteFile(7)).rejects.toThrow(
      "삭제가 계속 진행될 수 있습니다",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await checked;
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
