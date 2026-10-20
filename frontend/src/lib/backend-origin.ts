export function backendOrigin(
  value = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000",
): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "BACKEND_API_URL은 http://127.0.0.1:<포트> 형식이어야 합니다.",
    );
  }
  return url.origin;
}
