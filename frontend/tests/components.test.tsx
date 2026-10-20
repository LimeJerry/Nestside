import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import { FileList } from "@/components/file-list";
import { UploadPanel } from "@/components/upload-panel";
import { formatSize, formatDate } from "@/lib/format";

it("빈 목록을 표시한다", () => {
  render(<FileList files={[]} loading={false} error={false} />);
  expect(screen.getByText("아직 저장된 파일이 없습니다")).toBeVisible();
});
it("로딩과 오류를 빈 목록과 구분한다", () => {
  const { rerender } = render(<FileList files={[]} loading error={false} />);
  expect(screen.getByText("파일을 불러오고 있습니다")).toBeVisible();
  rerender(<FileList files={[]} loading={false} error />);
  expect(screen.getByText("파일 목록을 확인할 수 없습니다")).toBeVisible();
});
it("다운로드 링크를 유지하고 삭제 버튼을 표시한다", () => {
  render(
    <FileList
      files={[
        {
          id: 1,
          filename: "한글 #.txt",
          size: 5,
          sha256: "hash",
          uploaded_at: "2026-10-20T00:00:00Z",
          content_type: null,
        },
      ]}
      loading={false}
      error={false}
    />,
  );
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    `/api/download/${encodeURIComponent("한글 #.txt")}`,
  );
  expect(screen.getByRole("link")).toHaveAttribute("download", "한글 #.txt");
  expect(screen.getByRole("button", { name: "한글 #.txt 삭제" })).toBeVisible();
});
it("파일 선택 전 업로드를 비활성화하고 성공 후 선택을 비운다", async () => {
  const user = userEvent.setup();
  const onUpload = vi.fn().mockResolvedValue(true);
  render(<UploadPanel uploading={false} progress={null} onUpload={onUpload} />);
  expect(screen.getByRole("button", { name: "업로드" })).toBeDisabled();
  const file = new File(["abc"], "hello.txt");
  await user.upload(screen.getByLabelText("업로드할 파일 선택"), file);
  await user.click(screen.getByRole("button", { name: "업로드" }));
  expect(onUpload).toHaveBeenCalledWith(file);
  expect(screen.getByRole("button", { name: "업로드" })).toBeDisabled();
});
it("실패한 업로드의 선택을 유지한다", async () => {
  const user = userEvent.setup();
  render(
    <UploadPanel
      uploading={false}
      progress={null}
      onUpload={vi.fn().mockResolvedValue(false)}
    />,
  );
  await user.upload(
    screen.getByLabelText("업로드할 파일 선택"),
    new File(["x"], "failed.txt"),
  );
  await user.click(screen.getByRole("button", { name: "업로드" }));
  expect(screen.getByText("failed.txt")).toBeVisible();
});
it("100%를 서버 저장 완료로 표시하지 않는다", () => {
  render(<UploadPanel uploading progress={100} onUpload={vi.fn()} />);
  expect(screen.getByText(/서버 저장 결과/)).toBeVisible();
  expect(screen.getByLabelText("업로드할 파일 선택")).toBeDisabled();
});
it("파일 크기와 잘못된 날짜를 표시한다", () => {
  expect(formatSize(0)).toBe("0 B");
  expect(formatSize(1024)).toBe("1 KB");
  expect(formatSize(1024 ** 3)).toBe("1 GB");
  expect(formatDate("invalid")).toBe("날짜 확인 필요");
});
