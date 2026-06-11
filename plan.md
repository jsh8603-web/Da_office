---
tags: [type/plan, domain/memo-rag, project/Da_office]
date: 2026-06-11
session: btn-Da_office
status: locked → harness2 실행 대기
---

# Plan — Da_office 회사용 메모/이메일 색인 (memo-RAG 코어 이식)

## Goal

`~/.claude/scripts/da-vector` 의 memo-RAG 색인+검색 코어를 회사 환경에서 독립 실행 가능하게 이식.
회사 Claude Code 가 MCP tool(`search_memo`)로 Obsidian vault(추후 Teams)를 의미 검색. 완성 후 GitHub(private) 업로드.

## 확정 설계 (사용자 합의 2026-06-11)

- **임베딩**: 로컬 BGE-M3 (`embed_service.py` 원본 그대로). 오프라인·데이터 외부유출 0.
- **색인 대상**: Obsidian md vault (1차). Teams = 어댑터 자리만 (스텁), Graph API 권한은 회사 IT 병행 확인.
- **사용 형태**: MCP server → `search_memo` tool (회사 Claude Code 자동 호출).
- **lancedb 제거**: memo lane 은 원래 flat jsonl brute-force(exact, 정확도 손실 0). 네이티브 바이너리 설치 부담 제거. >5만 청크 시 lancedb 재도입(jsonl 포맷 유지로 lock-in 없음).
- **소스 무관(source-agnostic)**: 모든 소스 → `{id, text, source, path, date}` 정규화 → 색인/검색 코어는 소스 무관.

## 파일 인벤토리 (D:\projects\Da_office)

| 파일 | 신규/복사 | 역할 | 원본 기준 |
|---|---|---|---|
| `embed_service.py` | 복사(수정0) | BGE-M3 embed + rerank :8787 | `~/.claude/scripts/da-vector/embed_service.py` |
| `requirements.txt` | 신규 | `flagembedding`, `fastapi`, `uvicorn[standard]` | — |
| `package.json` | 신규 | `@modelcontextprotocol/sdk`, `zod`, `type:module` (lancedb 없음) | — |
| `config.json` | 신규 | vault 경로 / embed url / 청크크기 / tau / tau_r | — |
| `src/sources/vault.mjs` | 신규 | vault `**/*.md` glob → frontmatter strip → 청킹 → 정규화 레코드 | memo-corpus-build 대체 |
| `src/sources/teams.mjs` | 신규(스텁) | 어댑터 인터페이스만 (`async function harvest(): Record[]` throw not-impl) | — |
| `src/build-index.mjs` | 신규 | 소스 어댑터 호출 → batch embed → `data/vectors.jsonl` | memo-vectors-build 이식 |
| `src/search.mjs` | 신규 | jsonl 로드 → embed query → cosine rank → rerank 게이트. 함수 export | memo-recall-test + rerank 이식 |
| `src/mcp-server.mjs` | 신규 | `search_memo` MCP tool (stdio) | mcp_server.ts search_da 패턴 |
| `.gitignore` | 신규 | `data/`, `node_modules/`, 모델캐시, `*.bak` | — |
| `README.md` | 신규 | 회사 PC 셋업 가이드(pip/npm/서비스/색인/MCP 등록) | — |

## 청킹 전략 (vault.mjs)

- heading(`#`~`###`) 단위 1차 분할. heading 없는 노트 = ~1000자 슬라이딩(overlap 150자).
- frontmatter 제거하되 `title`(파일명)+`tags` 를 청크 text 앞에 prepend (검색 컨텍스트 보강).
- id = `{상대경로slug}#{청크idx}`. source="vault", path=상대경로, date=frontmatter date 또는 파일 mtime.
- 빈/20자 미만 청크 skip.

## 검색 게이트 (search.mjs)

- cosine garbage-floor `tau`(0.45) top-`preN`(8) pre-filter → `/rerank` score ≥ `tau_r`(0.30) → top-`topK`(5).
- ⚠️ **fail-OPEN** (memo lane 의 fail-CLOSED 와 다름): `search_memo` 는 사용자 명시 검색이므로 rerank 서비스 실패 시 cosine top-K 라도 반환(무발화보다 결과 우선). config 토글 `rerank: on|off`.

## Phases (harness2 실행 단위)

- **P1 스캐폴딩**: 디렉토리 + `package.json`/`requirements.txt`/`config.json`/`.gitignore` + `embed_service.py` 복사. 게이트: `npm install` 성공 + `python -c "import fastapi"`(설치 시).
- **P2 vault 어댑터**: `src/sources/vault.mjs` 청킹 구현. 게이트: 샘플 vault dir 던져 레코드 N개 정상 출력(id 유니크·text≥20).
- **P3 색인 빌더**: `src/build-index.mjs`. 게이트: 샘플 → `data/vectors.jsonl` 생성, 전 벡터 dim=1024 일치.
- **P4 검색 코어**: `src/search.mjs`. 게이트: 알려진 쿼리→정답 노트 top-1 hit smoke(임베드 서비스 가동 시).
- **P5 MCP + Teams 스텁**: `src/mcp-server.mjs` + `src/sources/teams.mjs`. 게이트: MCP stdio 핸드셰이크 + `search_memo` 호출 결과 JSON 정상.
- **P6 README + e2e**: 셋업 문서 + 실제 임베드 서비스로 vault 샘플 색인→검색 e2e 1회. (GitHub push 는 사용자 확인 후 별도)

## 실행 엔진 확정

전 phase **harness2-wf** (순차+검증, 신규 연동·회귀 위험 코드 = Worker 구현 + Verifier 검증). 내부 모델 전환은 harness2 담당.

## Immutable

- `embed_service.py` byte-untouched (원본 복사, 포트/모델 변경 금지).
- vectors.jsonl 포맷 `{id, text, source, path, date, vector}` 유지 (lancedb 재이식 호환).
- 회사 데이터 외부 전송 0 (로컬 임베딩 고정, 클라우드 임베딩 금지).

## Rollback

순수 신규 프로젝트라 회귀 대상 없음. 단계별 게이트 실패 시 해당 파일 재작성. GitHub push 전이라 외부 영향 0.
