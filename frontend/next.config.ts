import type { NextConfig } from "next";
import { backendOrigin } from "./src/lib/backend-origin";

// 테스트에서도 loopback 주소만 허용한다. 브라우저 입력으로 프록시 대상을 받지 않는다.
const backend = backendOrigin();

const config: NextConfig = {
  distDir: process.env.NESTSIDE_TEST_BUILD === "1" ? ".next-test" : ".next",
  allowedDevOrigins: ["172.30.1.46"],
  poweredByHeader: false,
  experimental: { proxyTimeout: 3_600_000 },
  async rewrites() {
    return [
      { source: "/api/files", destination: `${backend}/files` },
      {
        source: "/api/files/:fileId(\\d+)",
        destination: `${backend}/files/:fileId`,
      },
      { source: "/api/upload", destination: "/internal/upload" },
      {
        source: "/api/download/:filename",
        destination: `${backend}/download/:filename`,
      },
    ];
  },
};
export default config;
