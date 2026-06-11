---
tags: [type/progress, domain/memo-rag, project/Da_office]
date: 2026-06-11
session: btn-Da_office
plan: ./plan.md
engine: harness2-wf
---

# Progress — Da_office 메모 색인 코어 이식

> 실행 엔진: **harness2-wf** (전 step). Worker 구현 → Verifier 검증 → 필요 시 Healer.
> 원본 SSOT: `C:\Users\jsh86\.claude\scripts\da-vector\` (embed_service.py / lib/memo-*.mjs / mcp_server.ts).

## §진입 스냅샷

- cwd: `D:\projects\Da_office` (git 미초기화 — P6 후 사용자 확인 후 init+push)
- 확정 설계: 로컬 BGE-M3 / Obsidian vault 1차 / MCP `search_memo` / lancedb 제거 / source-agnostic
- 다음 행동: harness2-wf 진입 → P1 스캐폴딩

## Steps

- [ ] **P1 스캐폴딩** — `wf: harness2`
  - 디렉토리(`src/sources`, `data`) + `package.json`(@modelcontextprotocol/sdk, zod, type:module) + `requirements.txt` + `config.json` + `.gitignore` + `embed_service.py` 복사(원본 byte 동일)
  - 게이트: `npm install` 성공 / `embed_service.py` diff 0
- [ ] **P2 vault 어댑터** — `wf: harness2`
  - `src/sources/vault.mjs` — glob `**/*.md` → frontmatter strip → heading/슬라이딩 청킹 → `{id,text,source,path,date}` (plan §청킹전략)
  - 게이트: 샘플 dir → 레코드 N개, id 유니크, text≥20자
- [ ] **P3 색인 빌더** — `wf: harness2`
  - `src/build-index.mjs` — 소스 어댑터 → batch embed(:8787) → `data/vectors.jsonl` (memo-vectors-build 이식, BATCH=32, text.slice 1800)
  - 게이트: vectors.jsonl 생성 + 전 벡터 dim=1024
- [ ] **P4 검색 코어** — `wf: harness2`
  - `src/search.mjs` — jsonl 로드 → embed query → cosine rank(nrm+dot) → rerank 게이트(fail-OPEN, plan §검색게이트). 함수 export
  - 게이트: 알려진 쿼리 top-1 hit smoke(서비스 가동 시)
- [ ] **P5 MCP + Teams 스텁** — `wf: harness2`
  - `src/mcp-server.mjs` — `search_memo` tool(mcp_server.ts search_da 패턴, search.mjs 호출) + `src/sources/teams.mjs` 스텁
  - 게이트: stdio 핸드셰이크 + search_memo JSON 정상
- [ ] **P6 README + e2e** — `wf: harness2`
  - `README.md` 회사 셋업 가이드 + 실제 서비스로 vault 샘플 색인→검색 e2e 1회
  - 게이트: e2e 검색 결과 정상 / push 는 사용자 확인 후

## Working Notes

- (진행 중 ckpt 기록)
