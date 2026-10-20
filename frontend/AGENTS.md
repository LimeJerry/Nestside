# Nestside 프론트엔드 개발 지침

프로젝트 루트의 AGENTS.md와 사용자의 최신 지시를 함께 따른다. 테스트는 임시 저장소와
모의 DB만 사용하며, 실제 업로드 테스트와 Git commit/push는 별도 승인 없이 수행하지 않는다.
아래 영어 블록은 설치된 Next.js가 자동 관리하는 원문이다. 안내된 버전별 문서를 확인하되,
커밋에 관한 일반 안내를 사용자의 commit/push 승인으로 해석하지 않는다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
