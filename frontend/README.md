# Nestside Web v0.1

Next.js 16.4.2 · React 19.3.1 · TypeScript · Tailwind CSS 4.3.3 기반 파일 관리 UI입니다.
파일 목록·단일 파일 업로드·다운로드·삭제 확인 UI를 제공합니다. 삭제는 기존 백엔드의 기본 비활성화 정책을 그대로 따릅니다.

**인증이 없는 내부망 개발용입니다. 인터넷에 공개하거나 공유기 포트 포워딩으로 노출하지 마세요.**
Ubuntu 서버와 Windows PC가 신뢰할 수 있는 동일 내부망에 있는 환경을 전제로 합니다.
프록시와 CORS는 사용자 인증을 대신하지 않습니다.

## Ubuntu 실행 방법

### 1. 기존 FastAPI 서버 확인 또는 시작

이미 127.0.0.1:8000에서 실행 중이면 중복 실행하지 않습니다.
새로 시작해야 한다면 Ubuntu의 별도 터미널에서 다음을 실행합니다.

```bash
cd /home/limeserver/ai-cloud
NESTSIDE_ENABLE_DELETE=false .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

기존 프로젝트 루트 .env의 DB 설정을 사용합니다. 비밀정보를 출력하거나 frontend로 복사하지 마세요.
이 명령을 문서 작성·테스트 과정에서 운영 서버에 실행하지 않았습니다.
실제 UI에서 업로드 버튼을 누르면 연결된 백엔드 저장소와 DB에 새 파일이 기록됩니다.
운영 서버를 대상으로 업로드 테스트를 하려면 별도 승인을 받아야 합니다.

### 2. Node.js와 npm 준비

Node.js 22 이상이 필요합니다. 이 서버의 시스템 Node 18은 변경하지 않았습니다.
이번 작업에서는 frontend/.runtime에 Node 22.23.3과 npm 11을 설치해 검증했습니다.
새 터미널에서는 프로젝트 내부 런타임을 먼저 PATH에 추가하세요.

```bash
cd /home/limeserver/ai-cloud/frontend
export PATH="$PWD/.runtime/node_modules/.bin:$PATH"
node --version
npm --version
```

다른 환경에서 .runtime이 없고 시스템 Node가 오래된 경우, 다음으로 프로젝트 안에만
런타임을 설치할 수 있습니다. 전역 Node나 다른 프로젝트는 변경하지 않습니다.

```bash
npm install --prefix .runtime --no-save --no-audit --no-fund node@22.23.3 npm@11.21.1
export PATH="$PWD/.runtime/node_modules/.bin:$PATH"
```

이미 Node 22 이상과 호환 npm이 설치되어 있다면 .runtime 설정은 생략할 수 있습니다.

### 3. 프론트엔드 실행

```bash
cd /home/limeserver/ai-cloud/frontend
# 새 체크아웃에서 의존성을 설치할 때 실행합니다.
npm ci
npm run dev
```

개발 서버는 **0.0.0.0:3000**에 바인딩됩니다. Windows 브라우저에서 다음 주소로 접속합니다.

**http://172.30.1.46:3000**

Ubuntu의 실제 IP가 172.30.1.46이어야 합니다. 두 PC가 같은 내부망인지 확인하고,
접속이 안 되면 Windows PowerShell에서 다음으로 연결 상태를 확인하세요.

```powershell
Test-NetConnection 172.30.1.46 -Port 3000
```

Ubuntu 방화벽이 3000/TCP를 막는 경우 관리자와 허용 대역을 확인해야 합니다.
이번 작업에서는 방화벽·네트워크·기존 서비스 설정을 변경하지 않았습니다.
8000 포트는 Ubuntu loopback에 두므로 Windows에서 직접 접근할 필요가 없습니다.
개발 서버는 실행한 터미널에서 Ctrl+C로 종료합니다.

## 연결 및 대용량 전송 구조

기본 프록시 대상은 **http://127.0.0.1:8000**입니다. 브라우저는 상대 경로만 호출하므로
FastAPI CORS 변경 없이 같은 출처로 연결됩니다. 프론트엔드는 PostgreSQL에 직접 접속하지 않습니다.

| 브라우저 요청 | Next.js rewrites와 전달 경로 |
| --- | --- |
| GET /api/files | 외부 rewrite → http://127.0.0.1:8000/files |
| DELETE /api/files/{file_id} | 외부 rewrite → http://127.0.0.1:8000/files/{file_id} |
| POST /api/upload | 내부 rewrite → /internal/upload → 스트리밍 POST http://127.0.0.1:8000/upload |
| GET /api/download/{filename} | 외부 rewrite → http://127.0.0.1:8000/download/{filename} |

Next.js 16.4.2 외부 rewrite 구현은 요청 본문을 복제하며 기본 10MiB 버퍼 제한이 있습니다.
큰 업로드가 잘리거나 전체 본문이 메모리에 남는 것을 피하려고 업로드만 내부 rewrite와
스트리밍 Route Handler를 사용합니다. 그 핸들러는 request.body를 duplex: half로 전달하며
formData(), arrayBuffer(), text(), Buffer.concat() 등으로 업로드를 다시 읽지 않습니다.
의존성 내부 코드를 수정하거나 버퍼 제한을 파일 크기만큼 늘리지 않았습니다.

브라우저에서는 원본 File을 FormData에 추가해 XMLHttpRequest로 전송하고, 다운로드는
일반 링크와 브라우저 다운로드 기능을 사용합니다. 파일 본문을 JS의 전체 ArrayBuffer,
base64 또는 다운로드 Blob으로 만들지 않습니다. 업로드 100%는 서버 저장 성공과 구분합니다.
Next.js에 파일을 별도로 저장하지 않으며, 목록 JSON과 작은 상태 응답만 해석합니다.
다운로드 프록시의 유휴 제한은 1시간으로 설정했습니다. 무제한 전송 보장은 아닙니다.

서버 전용 BACKEND_API_URL은 loopback HTTP 주소만 허용합니다. 기본값으로 실행하면
별도 .env 파일이 필요 없습니다. frontend/.env.example에는 비밀정보 없는 예시만 있습니다.
설정을 바꾼 경우 개발 서버를 재시작하고, 빌드해서 실행한다면 다시 빌드하세요.
DB 비밀번호나 토큰에 NEXT_PUBLIC_ 접두사를 붙이지 마세요.

관련 공식 자료: [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites),
[본문 복제 제한](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize).
실제 선택은 설치된 Next.js 소스와 격리 스트리밍 테스트로 확인했습니다.

## 검증 명령

Node 22 환경을 활성화한 frontend 디렉터리에서 실행합니다.

```bash
npm test
npm run lint
npm run build
npm run typecheck
```

브라우저 테스트는 Chromium과 Python 가상환경이 필요합니다.

```bash
npx playwright install chromium
npm run test:e2e
```

이번 서버에서는 브라우저를 /tmp/nestside-playwright에 설치했으므로 다음으로 재사용할 수 있습니다.

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/nestside-playwright npm run test:e2e
```

브라우저 테스트는 127.0.0.1:13100의 별도 Next.js와 127.0.0.1:18080의 격리 FastAPI 앱을
자동 시작·종료합니다. 별도 .next-test 디렉터리를 사용하므로 실행 중인 일반 개발 서버의
빌드 잠금과 충돌하지 않습니다. 기존 3000/8000/13000 서버를 재사용하지 않으며 테스트 포트가
사용 중이면 실패합니다.
격리 앱은 임시 저장소와 모의 DB를 사용하고, 기존 backend 코드는 수정하지 않습니다.
16MiB 파일 왕복 해시와 업로드 완료 전 백엔드 수신을 검증합니다. 테스트 생성 파일은 임시
디렉터리에서 정리하며, 보고서·화면 캡처는 Git 제외된 test-results에 저장됩니다.

기존 백엔드 회귀 검증은 프로젝트 루트에서 실행합니다.

```bash
.venv/bin/python -B -m unittest backend.test_delete backend.test_stability
```

backend/test_db.py는 설정된 DB에 연결하므로 전체 테스트 자동 검색으로 실행하지 마세요.

## 삭제 UI 동작

각 파일의 삭제 버튼을 누르면 전체 파일명과 **삭제 후 복구가 보장되지 않는다**는 경고를
표시합니다. 처음에는 취소 버튼에 초점을 두고, 탭 키는 대화상자 안에서 순환합니다.
취소·Esc는 요청 없이 닫으며, 처리 중에는 취소·Esc·중복 확인과 업로드를 차단합니다.
닫힌 뒤 원래 버튼으로 초점을 돌리고, 삭제로 버튼이 없어졌다면 새로고침으로 돌립니다.

확인한 뒤에만 ID로 DELETE 요청을 보냅니다. 성공한 ID와 결과 형식을 검증한 후
목록에서 제거하고 목록을 재조회해 파일 수·전체 용량을 갱신합니다. 재조회 실패는 삭제
성공과 구분합니다. cleanup_pending 응답이면 서버의 임시 파일 정리에 관리자 확인이
필요함을 안내합니다. 403은 삭제 비활성화, 404는 파일 없음, 409는 충돌·복구 확인으로
안내합니다. 네트워크 오류·서버 오류·잘못된 성공 응답은 결과 불확실성으로 처리합니다.
1분 동안 응답이 없으면 브라우저 대기를 끝내지만, 서버 삭제가 계속될 수 있음을 알립니다.
자동으로 DELETE를 재요청하지 않습니다. 활성화 변수나 운영 .env는 UI에서 변경하지 않습니다.

## 실제 브라우저에서 안전하게 검증하기

실제 storage/와 운영 PostgreSQL을 사용하지 않도록 **3000/8000 운영 연결 대신 아래
13000/18080 임시 환경**에서 검증하세요. 자동 브라우저 테스트와 동시에 실행하면 포트가
겹치므로 한쪽을 종료해야 합니다. Windows PC와 Ubuntu 서버가 같은 내부망이어야 합니다.

Ubuntu 터미널 1에서 임시 파일·모의 DB 서버를 실행합니다. 생성하는 파일은 모두 테스트용이며
종료 시 정리됩니다. 별도 운영 DB 연결이나 기존 storage/ 변경은 하지 않습니다.

```bash
cd /home/limeserver/ai-cloud/frontend
../.venv/bin/python -B tests/mock_backend.py
```

Ubuntu 터미널 2에서 해당 격리 서버로 연결하는 프론트엔드를 실행합니다.

```bash
cd /home/limeserver/ai-cloud/frontend
export PATH="$PWD/.runtime/node_modules/.bin:$PATH"
BACKEND_API_URL=http://127.0.0.1:18080 npx next dev --hostname 0.0.0.0 --port 13000
```

Windows 브라우저에서 **http://172.30.1.46:13000**에 접속합니다.

1. 생성된 임시 파일의 삭제 버튼을 눌러 파일명·복구 경고와 취소 기본 초점을 확인합니다.
2. 취소·Esc로 닫고 파일이 유지되는지 확인합니다.
3. 처음에는 격리 서버의 삭제도 비활성화되어 있습니다. 확인을 누르면 비활성화 안내가
   나오고 파일이 유지되는지 확인합니다.
4. 삭제 성공을 검증하려면 Ubuntu의 별도 터미널에서 **격리 서버에만** 다음을 적용합니다.

```bash
curl -X POST 'http://127.0.0.1:18080/__test/delete-mode?enabled=true'
```

5. 임시 파일을 삭제하고 목록·파일 수·전체 용량이 갱신되는지 확인합니다.
6. 임시 파일을 업로드·다운로드하며 기존 기능이 유지되는지도 확인합니다.
7. 종료 전 격리 서버를 다시 비활성화할 수 있습니다. 두 서버는 각각 Ctrl+C로 종료합니다.

```bash
curl -X POST 'http://127.0.0.1:18080/__test/delete-mode?enabled=false'
```

__test/delete-mode는 테스트 서버에만 있는 제어 경로입니다. 운영 FastAPI의 기본 비활성화
정책을 바꾸지 않습니다. 불확실한 결과가 나오면 재삭제하지 말고 목록·관리자 확인을 먼저 하세요.
실제 Windows의 방화벽 통과·접속 여부는 사용자 환경에서 별도로 확인해야 합니다.

## 남은 범위와 제약

- 인증·소유권·PC 동기화·AI 검색은 없습니다. 백엔드 삭제 기본 비활성화는 유지합니다.
- 16MiB 전송과 단계별 스트리밍은 검증했지만 GB급·동시 대용량 메모리 상한은 미측정입니다.
  백엔드의 동기 I/O·전체 해시 계산·디스크 여유 공간과 Node 업스트림 시간 제한도 영향을 줍니다.
- 전송 중단 후 자동 재개·자동 재시도는 하지 않습니다. 결과가 불확실하면 목록·복구 상태를
  먼저 확인하도록 안내합니다. 다운로드 실패 시 서버 JSON이 다운로드 파일로 저장될 수 있습니다.
- 목록 페이지네이션은 없으며 실제 디스크 사용량을 표시하지 않습니다.
- 브라우저는 Windows에서 허용되지 않는 '?' 등의 다운로드 파일명을 치환할 수 있습니다.
- Linux Chromium 자동 테스트와 Windows 내부망 수동 삭제 통합 테스트를 통과했습니다.
  Windows 테스트에서는 지정된 0바이트 파일 한 개의 삭제 및 기존 두 파일·DB 메타데이터 보존을
  확인했습니다. 다른 네트워크 환경과 일반적인 운영 장애까지 검증한 것은 아닙니다.
- 프로덕션 빌드는 통과해도 인증·보안·운영 배포 준비가 완료됐다는 의미는 아닙니다.
