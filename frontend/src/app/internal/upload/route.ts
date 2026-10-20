import { backendOrigin } from "@/lib/backend-origin";

export const runtime = "nodejs";

// 외부 rewrite의 본문 복제를 피한다. FormData 파싱이나 전체 본문 버퍼를 만들지 않는다.
export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data;") || !request.body) {
    return Response.json({ detail: "Invalid upload request" }, { status: 400 });
  }
  const headers = new Headers({ "content-type": type });
  const length = request.headers.get("content-length");
  if (length) headers.set("content-length", length);
  try {
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers,
      body: request.body,
      duplex: "half",
      cache: "no-store",
      signal: request.signal,
      redirect: "error",
    };
    const response = await fetch(`${backendOrigin()}/upload`, init);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { detail: "Upload outcome uncertain; check file list before retrying" },
      { status: 502 },
    );
  }
}
