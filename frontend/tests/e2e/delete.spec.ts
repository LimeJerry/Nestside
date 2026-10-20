import { test, expect, type Page } from "@playwright/test";
import { formatSize } from "../../src/lib/format";
import type { StoredFile } from "../../src/types/file";

test.beforeEach(async ({ request }) => {
  const response = await request.post(
    "http://127.0.0.1:18080/__test/delete-mode?enabled=false",
  );
  expect(response.ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.post("http://127.0.0.1:18080/__test/delete-mode?enabled=false");
});
async function ask(page: Page, name = "시작 안내.txt") {
  await page.getByRole("button", { name: `${name} 삭제`, exact: true }).click();
  return page.getByRole("dialog");
}
async function uploadFixture(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("업로드할 파일 선택").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from("삭제 UI 격리 테스트용 임시 파일"),
  });
  await page.getByRole("button", { name: "업로드", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `${name} 삭제`, exact: true }),
  ).toBeVisible();
}

test("파일명·복구 경고·초점 순환을 확인하고 취소하면 삭제하지 않는다", async ({
  page,
}, info) => {
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "DELETE") requests++;
  });
  await page.goto("/");
  const dialog = await ask(page);
  await expect(
    dialog.getByText("시작 안내.txt", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(/삭제 후 복구가 보장되지 않습니다/),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "삭제하기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  await page.screenshot({
    path: info.outputPath("delete-dialog.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "시작 안내.txt 삭제", exact: true }),
  ).toBeFocused();
  expect(requests).toBe(0);
  await (await ask(page)).getByRole("button", { name: "취소" }).click();
  expect(requests).toBe(0);
});

test("기본 비활성화된 실제 API의 안내를 표시하고 임시 파일을 유지한다", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const dialog = await ask(page);
  await dialog.getByRole("button", { name: "삭제하기" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "비활성화" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "시작 안내.txt 삭제", exact: true }),
  ).toBeVisible();
  const response = await request.get(
    `http://127.0.0.1:18080/download/${encodeURIComponent("시작 안내.txt")}`,
  );
  expect(response.status()).toBe(200);
});

test("격리 API로 삭제하고 목록·파일 수·용량을 갱신한다", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:18080/__test/delete-mode?enabled=true");
  const name = "삭제 성공 확인.txt";
  await uploadFixture(page, name);
  const before: StoredFile[] = await (
    await request.get("http://127.0.0.1:18080/files")
  ).json();
  const removed = before.find((file) => file.filename === name)!;
  const dialog = await ask(page, name);
  await dialog.getByRole("button", { name: "삭제하기" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "파일을 삭제했습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${name} 삭제`, exact: true }),
  ).toHaveCount(0);
  const expected = before.filter((file) => file.id !== removed.id);
  await expect(
    page
      .getByText("목록의 파일", { exact: true })
      .locator("..")
      .locator("p")
      .last(),
  ).toHaveText(new RegExp(`^${expected.length}\\s*개$`));
  await expect(
    page
      .getByText("목록의 전체 용량", { exact: true })
      .locator("..")
      .locator("p")
      .last(),
  ).toHaveText(formatSize(expected.reduce((sum, file) => sum + file.size, 0)));
  expect(
    (
      await request.get(
        `http://127.0.0.1:18080/download/${encodeURIComponent(name)}`,
      )
    ).status(),
  ).toBe(404);
  expect(
    await (await request.get("http://127.0.0.1:18080/files")).json(),
  ).toEqual(expected);
  await expect(page.getByRole("button", { name: "새로고침" })).toBeFocused();
});

test("응답 대기 중 중복 확인·취소·업로드를 차단한다", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:18080/__test/delete-mode?enabled=true");
  const name = "중복 삭제 차단.txt";
  await uploadFixture(page, name);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  await page.route(/\/api\/files\/\d+$/, async (route) => {
    count++;
    await barrier;
    await route.fulfill({ response: await route.fetch() });
  });
  try {
    const dialog = await ask(page, name);
    await dialog.getByRole("button", { name: "삭제하기" }).click();
    await expect.poll(() => count).toBe(1);
    await expect(
      dialog.getByRole("button", { name: "삭제 중…" }),
    ).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "취소" })).toBeDisabled();
    await expect(page.getByLabel("업로드할 파일 선택")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "삭제 중…" })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    expect(count).toBe(1);
  } finally {
    release();
  }
  await expect(
    page.getByRole("status").filter({ hasText: "파일을 삭제했습니다" }),
  ).toBeVisible();
  expect(count).toBe(1);
});

for (const [status, message] of [
  [404, "파일을 찾을 수 없습니다"],
  [409, "복구 확인"],
  [500, "삭제 결과를 확인하지 못했습니다"],
] as const) {
  test(`오류 ${status}는 한국어로 안내하고 자동 재삭제하지 않는다`, async ({
    page,
  }) => {
    let count = 0;
    await page.route(/\/api\/files\/\d+$/, (route) => {
      count++;
      return route.fulfill({ status, json: { detail: "격리 오류 응답" } });
    });
    await page.goto("/");
    await (await ask(page)).getByRole("button", { name: "삭제하기" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: message }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "시작 안내.txt 삭제", exact: true }),
    ).toBeVisible();
    expect(count).toBe(1);
  });
}

test("정리 대기 모의 응답에 관리자 확인을 안내한다", async ({
  page,
  request,
}) => {
  const before: StoredFile[] = await (
    await request.get("http://127.0.0.1:18080/files")
  ).json();
  const target = before.find((file) => file.filename === "시작 안내.txt")!;
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "시작 안내.txt 삭제", exact: true }),
  ).toBeVisible();
  await page.route("**/api/files", (route) =>
    route.fulfill({ json: before.filter((file) => file.id !== target.id) }),
  );
  await page.route(`**/api/files/${target.id}`, (route) =>
    route.fulfill({
      json: { id: target.id, status: "deleted", cleanup_pending: true },
    }),
  );
  await (await ask(page)).getByRole("button", { name: "삭제하기" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "관리자 확인" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "시작 안내.txt 삭제", exact: true }),
  ).toHaveCount(0);
});

test("연결 단절 시 결과 불확실성을 안내하고 자동 재요청하지 않는다", async ({
  page,
}) => {
  let count = 0;
  await page.route(/\/api\/files\/\d+$/, (route) => {
    count++;
    return route.abort("failed");
  });
  await page.goto("/");
  await (await ask(page)).getByRole("button", { name: "삭제하기" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "다시 삭제하기 전에" }),
  ).toBeVisible();
  expect(count).toBe(1);
});
