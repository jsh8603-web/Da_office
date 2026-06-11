# memo-rag-mcp

Obsidian vault memo-RAG search as an MCP server.

Local BGE-M3 embeddings via `embed_service.py` — no cloud API, no LanceDB.
Flat `vectors.jsonl` brute-force search (exact cosine). Source-agnostic adapter design (vault + Teams stub).

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

`config.json`의 `vault_path`를 본인 Obsidian vault 경로로 수정합니다:

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
      "args": ["D:/projects/memo-rag-mcp/src/mcp-server.mjs"]
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
