---
date: 2025-03-15
tags: [work, project]
---

# 프로젝트 노트

## 배경

이 프로젝트는 memo-RAG 시스템을 회사 환경에 이식하는 작업입니다.
주요 목표는 BGE-M3 임베딩을 로컬에서 실행하고, lancedb 없이 flat jsonl로 검색하는 것입니다.

## 구현 계획

1. embed_service.py 복사
2. vault 어댑터 구현
3. MCP 서버 구성

## 주의사항

회사 데이터는 외부 전송 금지. 로컬 임베딩 고정.
