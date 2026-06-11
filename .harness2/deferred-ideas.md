# Deferred Ideas (SR Mode A 재검토 대상)

## DI-1 — source-agnostic 살아있는 멀티소스 메모리 (SR Pre-Review Type A, 2026-06-11)
- **비전**: harvest() 가 `{id,text,source,path,date,content_hash}` 통일 스키마 반환 + `index-state.json`(source_id→content_hash→vector_ids) delta 인덱서. 2년 후 Teams 어댑터가 conversation-window 그룹핑으로 같은 파이프 재사용. vault/teams 가 record 스키마 1개로 통일되고 재인덱싱이 변경분만 처리 → 회사 독립 이식이 1회성 복사가 아니라 살아있는 멀티소스 메모리가 됨.
- **현 MVP 반영분**: content_hash 필드 + index-state.json 기록 + hash-skip 까지(Phase 3). full delta(vector_ids 매핑·삭제 GC·증분 upsert)는 Phase 6 이후 확장.
- **재검토 시점**: Teams 어댑터 실제 연동 단계(Graph API 권한 확보 후) 또는 vault 규모 수만 청크 도달 시.
