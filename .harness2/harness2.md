# harness2.md — 실행 계획 (harness-wf 의 harness.md 등가, Supervisor 가 ② 단계 작성)

> 생성: h2-bootstrap.sh @ 1781182970060 | 런타임 SSOT: D:/projects/Da_office/.harness2 | 규칙: ~/.claude/skills/harness2-wf/protocol.md

## Pipeline Goal
memo-RAG 색인+검색 코어를 회사 환경 독립 실행 MCP(search_memo)로 이식. Obsidian vault 1차 색인 + Teams 어댑터 스텁. 로컬 BGE-M3 임베딩, lancedb 제거(flat jsonl brute-force exact), source-agnostic. 원본 SSOT = C:\Users\jsh86\.claude\scripts\da-vector (embed_service.py / lib/memo-vectors-build.mjs / lib/memo-recall-test.mjs / mcp_server.ts). 완성 후 GitHub(private) 업로드(push는 사용자 확인 후).

## Sacred Zone (불가침 — SR 도 도전 금지)
embed_service.py 원본 byte-untouched(포트8787·BGE-M3·엔드포인트 변경금지). vectors.jsonl 포맷 {id,text,source,path,date,vector} 유지(lancedb 재이식 호환). 회사 데이터 외부전송 0(로컬 임베딩 고정, 클라우드 임베딩 API 금지). 기존 ~/.claude/scripts/da-vector 원본 파일 무수정(읽기 전용 참조).

## Open Zone (도전 허용 — SR 창의 대상)
청킹 전략 세부(heading vs 슬라이딩 파라미터·overlap). 검색 게이트 tau(0.45)/tau_r(0.30) 튜닝. config.json 스키마 설계. README 셋업 가이드 구성.

## ⚡ SR Pre-Review Directive 반영 확정 (Supervisor mediation 2026-06-11 — Worker 필수 준수)
SR mode C + Supervisor falsify(embed_service.py 코드 대조) 결과 아래 3건 확정. sub-obj 표보다 우선 적용:
1. **tau_r=0.30 유지(코드변경 없음)**: SR 의 "unbounded logit → sigmoid 전환" 제안은 embed_service.py:81-86 `compute_score(normalize=True)` 가 이미 sigmoid[0,1] 정규화하므로 불필요(falsify). config.json 에 `tau_r:0.30` 키로 노출만(튜닝 가능하게). search.mjs 의 /rerank score 는 0~1 가정 유지.
2. **min_chunk_chars=50 (SUBOBJ 1.3·2.2 적용)**: config.json 에 `min_chunk_chars:50` 추가. SUBOBJ 2.2 의 "20자 미만 skip" → "min_chunk_chars(50) 미만 skip" 으로 상향. cross-encoder 가 짧은 context 에서 random score 내는 것 방지.
3. **content_hash 필드 + delta 스캐폴딩 (SUBOBJ 2.1·3.1 적용)**: vault 레코드에 `content_hash`(text 의 sha256 8자) 필드 추가. build-index 는 `data/index-state.json`{id→content_hash} 를 기록하고, 다음 빌드 시 hash 동일 레코드는 재임베드 skip(있으면 기존 vector 재사용). full delta 최적화는 MVP 범위 밖 — **필드 + index-state.json 기록 + skip 로직까지만**. CPU BGE-M3 재인덱싱 실용성 확보.

## Phase → Final Objective → Sub-obj (4원칙: 관찰가능성·원자성·커버리지·독립성)
| Phase | Final Objective | Sub-obj | 설명 | 검증(객관) | 담당 |
|---|---|---|---|---|---|
| 1 | 프로젝트 스캐폴딩 + 의존성 manifest + embed_service 복사 | 1.1 | 디렉토리(src/sources, data) + .gitignore(data/ 색인산출물, node_modules/, __pycache__, *.bak, 모델캐시) 생성 | test -d src/sources && test -d data && grep -q "data/" .gitignore | Worker→Verifier |
| 1 | 프로젝트 스캐폴딩 + 의존성 manifest + embed_service 복사 | 1.2 | package.json (deps=@modelcontextprotocol/sdk+zod, type:module, lancedb 미포함) + requirements.txt(flagembedding,fastapi,uvicorn[standard]) | node -e "JSON.parse(require('fs').readFileSync('package.json'))" 성공 && ! grep -q lancedb package.json && grep -q flagembedding requirements.txt | Worker→Verifier |
| 1 | 프로젝트 스캐폴딩 + 의존성 manifest + embed_service 복사 | 1.3 | config.json (vault_path, embed_url=http://127.0.0.1:8787, tau=0.45, tau_r=0.30, pre_n=8, top_k=5, chunk_size=1000, chunk_overlap=150, rerank=on) | node -e "const c=JSON.parse(require('fs').readFileSync('config.json'));['vault_path','embed_url','tau','tau_r','top_k'].forEach(k=>{if(!(k in c))throw k})" 성공 | Worker→Verifier |
| 1 | 프로젝트 스캐폴딩 + 의존성 manifest + embed_service 복사 | 1.4 | embed_service.py 원본 복사(byte 동일) + requirements 와 정합 | diff embed_service.py "C:/Users/jsh86/.claude/scripts/da-vector/embed_service.py" 출력 0줄 | Worker→Verifier |
| 2 | vault 소스 어댑터 — Obsidian .md → 정규화 청크 레코드 | 2.1 | src/sources/vault.mjs — glob 재귀 **/*.md, YAML frontmatter strip, heading(#~###) 분할+heading 없으면 ~chunk_size 슬라이딩(overlap), 레코드 {id,text,source:"vault",path,date} 반환 export harvest(cfg) | 임시 샘플 vault(2~3개 md, 1개는 긴 노트) 입력→harvest 호출→레코드 배열 length>0, 전 id 유니크, 전 text.length>=20 | Worker→Verifier |
| 2 | vault 소스 어댑터 — Obsidian .md → 정규화 청크 레코드 | 2.2 | title(파일명)+tags 를 청크 text 앞에 prepend, date=frontmatter date 또는 파일 mtime(ISO) 채움, 빈/20자미만 청크 skip | 샘플 청크 text 가 파일명으로 시작 && 전 레코드 date 비어있지 않음(정규식 \d{4}-\d{2}-\d{2}) | Worker→Verifier |
| 3 | 색인 빌더 — 소스 어댑터 → batch embed → vectors.jsonl | 3.1 | src/build-index.mjs — config 로드→vault.harvest()→batch(32) POST embed_url/embed(text.slice 1800)→data/vectors.jsonl 각줄 {id,text,source,path,date,vector} + 빌드 요약(count,dim,by_source) stdout | 샘플 vault 로 실행→data/vectors.jsonl 존재 && node 로 전 줄 파싱 성공 && 전 vector.length 동일(임베드 서비스 :8787 가동 시 1024; 미가동 시 fetch 실패를 명확한 에러로 보고하는지 확인) | Worker→Verifier |
| 4 | 검색 코어 — cosine rank + rerank 게이트(fail-OPEN) | 4.1 | src/search.mjs — vectors.jsonl 로드, embed query, cosine rank(정규화 후 dot, memo-recall-test.mjs rank 이식), source 필터 옵션, export searchMemo(query,opts) | 모듈 import 성공 && searchMemo 함수 존재 && 샘플 색인+알려진쿼리 top-1 가 관련 청크(서비스 가동 시) | Worker→Verifier |
| 4 | 검색 코어 — cosine rank + rerank 게이트(fail-OPEN) | 4.2 | rerank 게이트 — cosine tau(0.45) top pre_n(8) → POST /rerank score>=tau_r(0.30) → top_k(5). ⚠️ fail-OPEN: rerank=off OR 서비스 실패 시 cosine top_k 반환(무발화 금지) | config rerank:off → cosine 결과 반환 확인 && rerank fetch 실패 시뮬(잘못된 url)→예외 던지지 않고 cosine fallback 결과 반환 | Worker→Verifier |
| 5 | MCP 서버 + Teams 어댑터 스텁 | 5.1 | src/mcp-server.mjs — McpServer stdio, tool "search_memo"(query:string, k?:number, source?:string)→search.searchMemo 호출→{results:[{id,path,score,snippet}]} JSON. embed 서비스 미가동 시 {error} graceful(mcp_server.ts search_da 패턴) | node src/mcp-server.mjs 와 stdio MCP initialize 핸드셰이크 성공 && tools/list 에 search_memo 노출 && search_memo 호출이 JSON 구조 반환(에러도 JSON) | Worker→Verifier |
| 5 | MCP 서버 + Teams 어댑터 스텁 | 5.2 | src/sources/teams.mjs 스텁 — export async harvest(cfg) { throw new Error("teams source not implemented — MS Graph API 연동 대기") } + 상단 주석으로 어댑터 인터페이스 명세(vault.mjs 와 동일 시그니처) | import 성공 && harvest() 호출 시 "not implemented" 포함 에러 && 주석에 인터페이스 시그니처 기재 | Worker→Verifier |
| 6 | README 셋업 가이드 + e2e 검증 | 6.1 | README.md — 회사 PC 셋업 5단계(1.pip install -r requirements.txt 2.python embed_service.py 3.npm install 4.config.json vault_path 설정+node src/build-index.mjs 5.회사 Claude Code mcp 등록 .mcp.json 예시 코드블록) + 아키텍처 1단락 + lancedb 제거/source-agnostic 설계 노트 | README 에 5단계 셋업 헤딩 && mcp 등록 JSON 코드블록(command:node, args mcp-server.mjs) 존재 && pip/npm 명령 포함 | Worker→Verifier |
| 6 | README 셋업 가이드 + e2e 검증 | 6.2 | e2e — 임시 샘플 vault(3~4 md) → build-index → searchMemo 2개 쿼리 → 관련 청크 top-K 반환 1회 실증(로컬 :8787 embed 서비스 가동 가정; 미가동 시 그 사실과 mock 흐름 검증 결과를 execution-log 에 명시) | e2e 스크립트 실행→2쿼리 모두 비어있지 않은 results && 최소 1쿼리 top-1 이 의미상 관련(샘플 정답 라벨 대조) | Worker→Verifier |


## 역할 배정 (agentId 영속 = resume 관통)
- **Worker(active)**: Sub-obj 순차 구현 (turn 카운터 self-relay → Standby 인계, handoff-key 관통)
- **Standby1~5**: dormant pool, SendMessage(name) 로 active 승계
- **Verifier**: 각 Sub-obj 독립검증 (zero-main step-gate 랑데부, verdict idempotent)
- **watchdog(haiku)**: liveness probe only (ctx 측정 불가 = CTX-INVISIBLE 실증)
- **Healer**: Verifier FAIL 시 (on-demand, 9-step)
- **SR**: Pre-Review(C) / T1-T4 / Post-Review(A) (on-trigger)


## Sufficiency Check (Supervisor 만 기입 — Phase 완료 시 충분성 2방향 5기준)
| Phase | ↑세부→Phase Final 달성? | ↓Phase Final→Pipeline Goal? | 5기준(사용자가치/커버리지갭/통합정합/부작용/범위드리프트) | 판정 |
|---|---|---|---|---|
| (Phase 완료마다 Supervisor 기입) | | | | |

## 🔄 Reflection & Closing (⑧ 세션 정리 — RC-1~RC-6 순서, RC-1~5.5 전 체크 전 종료 금지)
- [ ] **RC-1** 각 역할 agent 에 reflection 질문 전송 ([REFLECT] Q1 어려웠던점 / Q2 발견제약 / Q3 개선아이디어 → execution-log 기록 지시)
- [ ] **RC-2** 수집 (완료푸시 회수)
- [ ] **RC-3** Supervisor 자체 reflection — 4필드(대상파일 / 현재 L{줄} / 변경제안 / 근거 / 영향범위), 모호서술 금지
- [ ] **RC-4** promotion-log 기록 (ERROR/K/P 분류, 없으면 "검토 완료 — 기록 대상 없음" 명시)
- [ ] **RC-5** 사용자 보고 + improvement-registry.md 5필드 행 추가
- [ ] **RC-5.5** progress.md 체크박스 일괄 반영 (존재 시; 완료=[x], 미완=그대로)
- [ ] **RC-6** 정리 — watchdog TaskStop + 역할 agent "summarize and stop" + .harness2/.active 제거 (디제스트 절대정리금지 목록 준수)

## 통신 프로토콜 (메인 = relay 아님)
- content SSOT = `D:/projects/Da_office/.harness2/execution-log.jsonl` (append-only, atomic). 전 역할 여기 기록.
- Worker↔Verifier·Verifier→Healer·Healer→Verifier = zero-main 공유파일 랑데부(`h2-log.sh wait`).
- Healer→Supervisor(Design FAIL/의존성) / SR↔Supervisor(T1-T4·Ignite) / retry≥3·DEADLOCK = 메인 결정점(저빈도).
- 완료푸시 = Supervisor wake(무료·자동). 메인 idle-by-default + code-sanity 6트리거만 개입.

## 파일 SSOT 맵 (각 역할 자기 기록처 인지 — harness-wf 동일)
| 파일 | 쓰는 역할 | 용도 |
|---|---|---|
| `D:/projects/Da_office/.harness2/harness2.md` | Supervisor | 본 실행계획(harness.md 등가) + Sufficiency + RC |
| `D:/projects/Da_office/.harness2/execution-log.jsonl` | 전 역할 | ev SSOT (wf_header/phase_start/done/verdict/fix_pattern/design_decision/handoff_key/watchdog/sr_review/mediation/rule_fix/phase_snapshot) |
| `D:/projects/Da_office/.harness2/phase-state.json` | Supervisor | 상태머신 S0~S11 atomic |
| `D:/projects/Da_office/.harness2/agents.json` | Supervisor | 역할→agentId (resume 관통) |
| `D:/projects/Da_office/.harness2/active-agents.json` | Supervisor | watchdog 입력 |
| `D:/projects/Da_office/.harness2/verdicts/phase-N.json` | Verifier | 판정 아카이브 |
| `D:/projects/Da_office/.harness2/improvement-registry.md` | Supervisor | ⑧ RC-5 5필드 행 |
| `D:/projects/Da_office/.harness2/deferred-ideas.md`·`inspiration-log.md` | SR | Mode A 재검토 대상 |

## 상태머신 / 8단계 / 9-step
protocol.md §3·§4·§7 준수. ⑦ = Worker_{N+1} ∥ Verifier_N 동시발행 + 공유파일 랑데부 + 워치독(IDLE 전환마다 1회, 미실행 시 ev:watchdog_skip 기록).
