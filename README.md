# memo-rag-mcp

Obsidian vault memo-RAG search as an MCP server.

Local BGE-M3 embeddings via `embed_service.py` — no cloud API, no LanceDB.
Flat `vectors.jsonl` brute-force search (exact cosine). Source-agnostic adapter design (vault + Teams stub).

## 의도 (왜 만들었나)

회사 환경의 Claude Code에서 **개인 Obsidian vault의 메모를 자연어로 의미 검색**하기 위한 MCP 서버입니다.
개인 PC에서 운영하던 DA(Decision Asset) 벡터 색인 시스템에서 **색인 + 검색 코어만 떼어내** 회사에서 독립 실행 가능하도록 이식했습니다. 회사 Claude Code가 `search_memo` 도구로 vault를 의미 기반으로 찾아줍니다.

**핵심 설계 결정과 그 이유:**

- **로컬 임베딩 (BGE-M3)** — 회사 메모는 민감 데이터입니다. 클라우드 임베딩 API로 내보내면 외부 전송이 발생하므로, 임베딩을 전부 로컬(`embed_service.py` :8787)에서 수행해 **데이터가 PC를 벗어나지 않습니다.**
- **LanceDB 제거** — vault 규모(수만 청크 미만)에서는 flat `vectors.jsonl` brute-force(전수 cosine)가 ANN보다 오히려 **정확도 손실이 0**이고, 네이티브 바이너리 설치 부담을 없앱니다. 규모가 커지면 동일한 jsonl 포맷을 그대로 LanceDB로 재이식할 수 있어 lock-in이 없습니다.
- **source-agnostic 어댑터** — vault·Teams·이메일 등 어떤 소스든 `{id, text, source, path, date, content_hash}`로 정규화하면 동일한 색인/검색 파이프를 재사용합니다. 현재는 vault 구현 + Teams 스텁이며, Teams는 MS Graph 권한 확보 후 어댑터만 추가하면 됩니다.
- **content_hash delta 색인** — 변경된 청크만 다시 임베딩합니다. CPU BGE-M3로도 대용량 vault 재인덱싱이 실용적입니다.
- **rerank fail-OPEN** — rerank 서비스가 죽어도 cosine 결과를 반환합니다(명시 검색이므로 무발화보다 결과 우선).

## Architecture

```
Obsidian vault (.md files)
      │
      ▼ src/sources/vault.mjs  (harvest)
      │  YAML frontmatter strip, heading split, sliding window chunks
      │  title+tags prepend, content_hash for delta indexing
      ▼
src/build-index.mjs  (batch embed → vectors.jsonl)
      │  POST embed_url/embed (batch=32, text[:1800])
      │  data/index-state.json (id→content_hash, delta skip)
      ▼
data/vectors.jsonl  {id, text, source, path, date, vector}
      │
      ▼ src/search.mjs  (cosine rank + rerank gate, fail-OPEN)
      │  cosine top-N → POST /rerank (tau_r=0.30, normalize=True sigmoid)
      ▼
src/mcp-server.mjs  (MCP stdio)
      └─ tool: search_memo(query, k?, source?)
```

**Design notes:**
- LanceDB removed — flat jsonl brute-force sufficient for vault scale (<10k notes)
- `embed_service.py` is Sacred Zone: byte-identical copy from original, port 8787, BGE-M3 unchanged
- All company data stays local — cloud embedding APIs never called
- `rerank` uses `/rerank` endpoint (BGE-Reranker-v2-m3, already sigmoid[0,1] via `normalize=True`)
- Source-agnostic: `harvest(cfg)` interface shared by `vault.mjs` and `teams.mjs` stub

---

## Setup (회사 PC 5단계)

### Step 1: Python 의존성 설치

```bash
pip install -r requirements.txt
```

설치 패키지: `flagembedding`, `fastapi`, `uvicorn[standard]`
BGE-M3 모델(~2.3GB)과 BGE-Reranker-v2-m3(~1.1GB)는 첫 실행 시 자동 다운로드됩니다.

### Step 2: 임베딩 서비스 시작

```bash
python embed_service.py
```

서비스가 `http://127.0.0.1:8787`에서 실행됩니다. 첫 실행 시 모델 다운로드로 수 분 소요될 수 있습니다.
`GET http://127.0.0.1:8787/health` 로 상태 확인 가능합니다.

### Step 3: Node.js 의존성 설치

```bash
npm install
```

### Step 4: vault_path 설정 + 색인 빌드

`config.example.json`을 `config.json`으로 복사한 뒤 `vault_path`를 본인 Obsidian vault 경로로 수정합니다 (`config.json`은 `.gitignore`에 있어 개인 경로가 커밋되지 않습니다):

```bash
cp config.example.json config.json
```

```json
{
  "vault_path": "C:/Users/yourname/Documents/MyVault",
  "embed_url": "http://127.0.0.1:8787",
  "tau": 0.45,
  "tau_r": 0.30,
  "top_k": 5,
  "rerank": "on"
}
```

색인 빌드:

```bash
node src/build-index.mjs
```

완료 시 `data/vectors.jsonl`이 생성되며 빌드 요약(count, dim, by_source)이 출력됩니다.

### Step 5: 회사 Claude Code MCP 등록

Claude Code 프로젝트의 `.mcp.json` 파일에 아래 내용을 추가합니다:

```json
{
  "mcpServers": {
    "memo-rag": {
      "command": "node",
      "args": ["<repo-clone-path>/src/mcp-server.mjs"]
    }
  }
}
```

`args`의 경로를 실제 설치 경로로 수정하세요. 등록 후 Claude Code를 재시작하면 `search_memo` 도구가 활성화됩니다.

---

## Tool: search_memo

| 파라미터 | 타입 | 설명 |
|---|---|---|
| `query` | string | 자연어 검색 쿼리 |
| `k` | number? | 반환 결과 수 (기본: config.top_k) |
| `source` | string? | 소스 필터 (`"vault"` 등, 생략 시 전체) |

**응답:**
```json
{
  "results": [
    { "id": "vault:note.md:abc12345", "path": "note.md", "score": 0.8234, "snippet": "..." }
  ]
}
```

임베딩 서비스 미가동 시: `{ "error": "embed service not running at :8787 — start python embed_service.py first" }`

---

## Delta 인덱싱

`build-index.mjs`는 `data/index-state.json`에 각 청크의 `content_hash`(sha256 앞 8자)를 기록합니다.
다음 빌드 시 hash가 동일한 청크는 재임베딩을 건너뜁니다. 변경된 청크만 새로 임베딩하므로
대용량 vault에서도 증분 업데이트가 빠릅니다.

## Teams 어댑터 (예정)

`src/sources/teams.mjs`는 Microsoft Graph API 연동 스텁입니다.
MS Graph API 인증 정보(tenant_id, client_id, client_secret)가 준비되면 구현 예정입니다.
`vault.mjs`와 동일한 `harvest(cfg)` 인터페이스를 공유합니다.
