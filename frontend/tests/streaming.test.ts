import { it, expect, vi } from "vitest";
import { backendOrigin } from "@/lib/backend-origin";
import { POST } from "@/app/internal/upload/route";

it("프록시 기본 대상은 Ubuntu loopback이다", () => {
  expect(backendOrigin("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
});
it.each([
  "https://example.com",
  "http://172.30.1.46:8000",
  "http://user:pass@127.0.0.1:8000",
  "http://127.0.0.1:8000/other",
  "http://127.0.0.1:8000?target=remote",
])("잘못된 프록시 대상은 거부한다: %s", (url) => {
  expect(() => backendOrigin(url)).toThrow();
});
it("업로드 본문 스트림을 파싱 없이 그대로 전달한다", async () => {
  const stream = new ReadableStream();
  const controller = new AbortController();
  const headers = new Headers({
    "content-type": "multipart/form-data; boundary=test",
    "content-length": "1024",
  });
  const request = {
    body: stream,
    headers,
    signal: controller.signal,
    formData: vi.fn(),
    arrayBuffer: vi.fn(),
  };
  const fetch = vi.fn().mockResolvedValue(
    new Response('{"status":"uploaded"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request as unknown as Request);
  const options = fetch.mock.calls[0][1];
  expect(options.body).toBe(stream);
  expect(options.duplex).toBe("half");
  expect(options.cache).toBe("no-store");
  expect(options.headers.get("content-length")).toBe("1024");
  expect(request.formData).not.toHaveBeenCalled();
  expect(request.arrayBuffer).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
});
it("잘못된 업로드 형식은 백엔드에 보내지 않는다", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const response = await POST({
    headers: new Headers({ "content-type": "application/json" }),
    body: new ReadableStream(),
  } as unknown as Request);
  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("업스트림 연결 오류는 불확실한 결과로 반환한다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const response = await POST({
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=test",
    }),
    body: new ReadableStream(),
    signal: new AbortController().signal,
  } as unknown as Request);
  expect(response.status).toBe(502);
});
