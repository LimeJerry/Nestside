import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { FileManager } from "@/components/file-manager";
import { ApiError, listFiles, deleteFile, uploadFile } from "@/lib/api";
import type { DeleteResult } from "@/types/file";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  listFiles: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
}));
const file = {
  id: 7,
  filename: "삭제 확인 파일.txt",
  size: 1024,
  sha256: "테스트 해시",
  content_type: "text/plain",
  uploaded_at: "2026-10-20T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listFiles).mockResolvedValue([file]);
  vi.mocked(deleteFile).mockResolvedValue({
    id: 7,
    status: "deleted",
    cleanup_pending: false,
  });
});
async function openDialog() {
  const user = userEvent.setup();
  render(<FileManager />);
  const trigger = await screen.findByRole("button", {
    name: `${file.filename} 삭제`,
  });
  await user.click(trigger);
  return { user, dialog: screen.getByRole("dialog"), trigger };
}
it("파일명과 복구 경고를 표시하고 취소에 초점을 둔다", async () => {
  const { dialog } = await openDialog();
  expect(within(dialog).getByText(file.filename)).toBeVisible();
  expect(
    within(dialog).getByText(/삭제 후 복구가 보장되지 않습니다/),
  ).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "취소" })).toHaveFocus();
  expect(deleteFile).not.toHaveBeenCalled();
});
it("취소하면 전송하지 않고 원래 버튼으로 초점을 돌린다", async () => {
  const { user, dialog, trigger } = await openDialog();
  await user.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(deleteFile).not.toHaveBeenCalled();
});
it("탭 키와 역방향 탭 키의 초점을 대화상자 안에서 순환한다", async () => {
  const { dialog } = await openDialog();
  const cancel = within(dialog).getByRole("button", { name: "취소" });
  const confirm = within(dialog).getByRole("button", { name: "삭제하기" });
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(cancel).toHaveFocus();
});
it("성공 후 목록과 전체 용량을 갱신한다", async () => {
  const { user, dialog } = await openDialog();
  vi.mocked(listFiles).mockResolvedValue([]);
  await user.click(within(dialog).getByRole("button", { name: "삭제하기" }));
  expect(deleteFile).toHaveBeenCalledExactlyOnceWith(file.id);
  await screen.findByText("아직 저장된 파일이 없습니다");
  expect(screen.getByText("목록의 전체 용량").parentElement).toHaveTextContent(
    "0 B",
  );
  expect(screen.getByRole("button", { name: "새로고침" })).toHaveFocus();
});
it("삭제 후 목록 갱신 실패가 삭제 성공을 되돌리지 않는다", async () => {
  const { user, dialog } = await openDialog();
  vi.mocked(listFiles).mockRejectedValue(new ApiError(503, "목록 갱신 실패"));
  await user.click(within(dialog).getByRole("button", { name: "삭제하기" }));
  await screen.findByText(`${file.filename} 파일을 삭제했습니다.`);
  expect(
    screen.queryByRole("button", { name: `${file.filename} 삭제` }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("목록의 전체 용량").parentElement).toHaveTextContent(
    "0 B",
  );
});
it("처리 중 중복 클릭·취소·업로드를 차단한다", async () => {
  let finish!: (result: DeleteResult) => void;
  vi.mocked(deleteFile).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { user, dialog } = await openDialog();
  const confirm = within(dialog).getByRole("button", { name: "삭제하기" });
  await user.dblClick(confirm);
  expect(deleteFile).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: "삭제 중…" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "취소" })).toBeDisabled();
  expect(screen.getByLabelText("업로드할 파일 선택")).toBeDisabled();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () =>
    finish({ id: 7, status: "deleted", cleanup_pending: false }),
  );
});
it("비활성화 시 파일을 유지하고 안내한다", async () => {
  vi.mocked(deleteFile).mockRejectedValue(
    new ApiError(403, "현재 서버에서는 파일 삭제가 비활성화되어 있습니다."),
  );
  const { user, dialog } = await openDialog();
  await user.click(within(dialog).getByRole("button", { name: "삭제하기" }));
  await screen.findByText(/비활성화되어 있습니다/);
  expect(
    screen.getByRole("button", { name: `${file.filename} 삭제` }),
  ).toBeVisible();
  expect(screen.getByText("목록의 전체 용량").parentElement).toHaveTextContent(
    "1 KB",
  );
});
it("정리 대기 응답을 일반 성공과 구분한다", async () => {
  vi.mocked(deleteFile).mockResolvedValue({
    id: 7,
    status: "deleted",
    cleanup_pending: true,
  });
  const { user, dialog } = await openDialog();
  vi.mocked(listFiles).mockResolvedValue([]);
  await user.click(within(dialog).getByRole("button", { name: "삭제하기" }));
  await screen.findByText(/임시 파일 정리가 남아/);
});
it("업로드 처리 중 삭제 버튼을 비활성화한다", async () => {
  let finish!: () => void;
  vi.mocked(uploadFile).mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve({ ...file, status: "uploaded" });
    }),
  );
  const user = userEvent.setup();
  render(<FileManager />);
  await screen.findByRole("button", { name: `${file.filename} 삭제` });
  await user.upload(
    screen.getByLabelText("업로드할 파일 선택"),
    new File(["임시 파일"], "업로드.txt"),
  );
  await user.click(screen.getByRole("button", { name: "업로드" }));
  expect(
    screen.getByRole("button", { name: `${file.filename} 삭제` }),
  ).toBeDisabled();
  await act(async () => finish());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: `${file.filename} 삭제` }),
    ).toBeEnabled(),
  );
});
