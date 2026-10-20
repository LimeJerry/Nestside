import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, open, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

test("실제 rewrites를 거쳐 목록과 파일 관리 버튼을 표시한다", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "나의 파일 보관함" }),
  ).toBeVisible();
  await expect(page.getByText("시작 안내.txt", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "시작 안내.txt 삭제", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/내부망 개발용/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("desktop.png"),
    fullPage: true,
  });
});

test("임시 저장소에만 업로드하고 목록을 갱신한다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("업로드할 파일 선택").setInputFiles({
    name: "브라우저 업로드.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("browser fixture"),
  });
  await page.getByRole("button", { name: "업로드", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("파일을 업로드했습니다");
  await expect(
    page.getByRole("link", { name: "브라우저 업로드.txt 다운로드" }),
  ).toBeVisible();
});

test("동일 이름 업로드 충돌을 표시한다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("업로드할 파일 선택").setInputFiles({
    name: "시작 안내.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("duplicate fixture"),
  });
  await page.getByRole("button", { name: "업로드", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "같은 이름의 파일" }),
  ).toBeVisible();
});

test("한글·특수문자 파일을 브라우저 기본 다운로드로 받는다", async ({
  page,
}) => {
  await page.goto("/");
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "한글 #?%& 공백.txt 다운로드" }).click();
  const download = await pending;
  // Chromium은 Windows에서도 유효한 이름으로 '?' 등을 치환할 수 있다.
  expect(download.suggestedFilename()).toContain("한글");
  expect(download.suggestedFilename()).toMatch(/공백\.txt$/);
  const saved = await download.path();
  expect(await readFile(saved!, "utf8")).toBe("special filename fixture\n");
});

test("빈 목록과 서버 오류를 구분한다", async ({ page }) => {
  await page.route("**/api/files", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(page.getByText("아직 저장된 파일이 없습니다")).toBeVisible();
  await page.route("**/api/files", (route) =>
    route.fulfill({ status: 503, json: { detail: "fixture error" } }),
  );
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "서버" }),
  ).toBeVisible();
  await expect(page.getByText("파일 목록을 확인할 수 없습니다")).toBeVisible();
});

test("모바일에서 전체 페이지 가로 넘침 없이 동작한다", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("시작 안내.txt", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile.png"),
    fullPage: true,
  });
});

test("16MiB 파일을 File 경로로 업로드하고 해시가 같은 다운로드를 확인한다", async ({
  page,
}) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "nestside-browser-large-"),
  );
  try {
    const source = path.join(directory, "large-fixture.bin");
    const file = await open(source, "w");
    await file.truncate(16 * 1024 * 1024);
    await file.close();
    await page.goto("/");
    await page.getByLabel("업로드할 파일 선택").setInputFiles(source);
    const result = page.waitForResponse((response) =>
      response.url().endsWith("/api/upload"),
    );
    await page.getByRole("button", { name: "업로드", exact: true }).click();
    const response = await result;
    expect(response.status()).toBe(200);
    const metadata = await response.json();
    expect(metadata.size).toBe(16 * 1024 * 1024);
    await expect(
      page.getByRole("link", { name: "large-fixture.bin 다운로드" }),
    ).toBeVisible();
    const pending = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "large-fixture.bin 다운로드" })
      .click();
    const download = await pending;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream((await download.path())!))
      hash.update(chunk);
    expect(hash.digest("hex")).toBe(metadata.sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Next.js가 업로드 전체를 기다리지 않고 백엔드에 스트리밍 전달한다", async ({
  request,
  baseURL,
}) => {
  await request.post("http://127.0.0.1:18080/__test/reset-transport");
  const boundary = "nestside-stream-boundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stream-fixture.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const chunk = Buffer.alloc(64 * 1024, 7);
  let upload: ReturnType<typeof httpRequest> | undefined;
  const completed = new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      upload = httpRequest(
        `${baseURL}/api/upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (part) => (body += part));
          response.on("end", () =>
            resolve({ status: response.statusCode!, body }),
          );
        },
      );
      upload.on("error", reject);
    },
  );
  // 실패 시에도 미완료 요청을 닫는다. 전체 파일을 메모리에 만들지 않는다.
  void completed.catch(() => {});
  try {
    upload!.write(head);
    upload!.write(chunk);
    await expect
      .poll(
        async () => {
          const state = await (
            await request.get("http://127.0.0.1:18080/__test/transport")
          ).json();
          return state.received > 0 && !state.complete;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    for (let i = 1; i < 64; i++)
      if (!upload!.write(chunk)) await once(upload!, "drain");
    upload!.end(tail);
    const result = await completed;
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).size).toBe(4 * 1024 * 1024);
  } finally {
    upload?.destroy();
  }
});
