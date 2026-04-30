# AI 도구 구성 가이드 (Claude Code & Cursor)

> 이 문서는 NEO Frontend 프로젝트에 설정된 Claude Code 및 Cursor 관련 파일들의 역할과 구조를 설명합니다.
> 기존 `README.md`와는 별개이며, AI 도구 자동화 워크플로우를 이해하거나 새 팀원이 온보딩할 때 참조하세요.

---

## 목차

1. [전체 구조 한눈에 보기](#1-전체-구조-한눈에-보기)
2. [Claude Code 관련 파일](#2-claude-code-관련-파일)
   - [CLAUDE.md (행동 규칙서)](#21-claudemd-행동-규칙서)
   - [.claude/agents/ (역할별 에이전트)](#22-claudeagents-역할별-에이전트)
   - [.claude/skills/ (커스텀 명령어)](#23-claudeskills-커스텀-명령어)
   - [.claude/hooks/ (자동 안전 게이트)](#24-claudehooks-자동-안전-게이트)
   - [.claude/state/ (승인 토큰)](#25-claudestate-승인-토큰)
   - [.claude/docs/ (분석 및 참조 문서)](#26-claudedocs-분석-및-참조-문서)
3. [Cursor 관련 파일](#3-cursor-관련-파일)
   - [.cursor/rules/ (Cursor 규칙)](#31-cursorrules-cursor-규칙)
   - [.cursor/skills/ (Cursor 스킬)](#32-cursorskills-cursor-스킬)
4. [자동화 워크플로우 사용법](#4-자동화-워크플로우-사용법)
5. [모델 분리 전략 요약](#5-모델-분리-전략-요약)
6. [안전 게이트 레이어 구조](#6-안전-게이트-레이어-구조)

---

## 1. 전체 구조 한눈에 보기

```
frontend/
├── CLAUDE.md                          # HQN FE Claude Code 행동 규칙서
│
├── .claude/
│   ├── settings.local.json            # 훅 배선 + 권한 설정
│   ├── agents/
│   │   ├── planner-opus-4_6.md        # Opus 4.6 - 분석/계획 에이전트
│   │   ├── implementer-sonnet.md      # Sonnet 4.6 - 구현 에이전트
│   │   └── reviewer-opus-4_6.md      # Opus 4.6 - 리뷰 에이전트
│   ├── skills/
│   │   ├── hqn-ado-pickup-task/       # 태스크 픽업 전체 플로우
│   │   ├── hqn-ado-finish-task/       # 태스크 완료 전체 플로우
│   │   ├── hqn-frontend-guardrails/   # 소프트 안전 규칙 문서
│   │   ├── pickup/                    # "일해라" → pickup 단축어 (5줄)
│   │   ├── finish/                    # "마무리" → finish 단축어 (5줄)
│   │   └── tasks/                     # 할당 태스크 목록 조회 (5줄)
│   ├── hooks/scripts/
│   │   ├── hqn_protect_paths.py       # PreToolUse: 경로 보호
│   │   ├── hqn_guard_shell.py         # PreToolUse: 셸 명령 게이트
│   │   ├── hqn_guard_mcp_ado.py       # PreToolUse: MCP ADO 도구 게이트
│   │   ├── hqn_after_edit_context.py  # PostToolUse: 검증 리마인더 (세션당 1회)
│   │   ├── hqn_start_approval.py      # 시작 승인 토큰 발급 CLI
│   │   ├── hqn_finish_approval.py     # 완료 승인 토큰 발급 CLI
│   │   └── hqn_session_log.py         # 세션 토큰/툴 사용량 분석 CLI
│   ├── state/
│   │   ├── hqn_start_approval.json    # 시작 승인 토큰 (TTL: 1시간)
│   │   ├── hqn_finish_approval.json   # 완료 승인 토큰 (TTL: 2시간)
│   │   ├── handoff.md                 # 플래너 핸드오프 (오케스트레이터가 저장)
│   │   ├── review_findings.md         # 리뷰어 findings (오케스트레이터가 저장)
│   │   ├── .edit_context_injected     # PostToolUse 1회 주입 플래그
│   │   └── complexity_verdict.txt     # 태스크 복잡도 판정 결과 (light/standard)
│   ├── CHANGELOG.md                   # 워크플로우 변경 히스토리
│   └── docs/
│       ├── CLAUDE_CODE_WORKFLOW.md            # 전체 워크플로우 상세 설명
│       ├── CLAUDE_CODE_HARNESS_ENGINEERING.md # 훅/안전게이트 설계 분석
│       ├── CLAUDE_CODE_MODEL_SPLIT.md         # 모델 분리 전략 분석
│       ├── AI_TOOLING_GUIDE.md                # 이 파일 (AI 도구 구성 가이드)
│       ├── composer-2-hqn-ado-workflow-audit.md
│       ├── GPT_54_HQN_ADO_AUTOMATION_REVIEW.md
│       └── OPUS_47_HQN_CLAUDE_CODE_REVIEW.md
│
└── .cursor/
    ├── rules/
    │   ├── neo.mdc                             # NEO 프론트엔드 공통 코딩 규칙
    │   ├── hqn_ado_local_router.mdc            # HQN ADO 자연어 라우팅
    │   ├── frontend_commit_pr_local_router.mdc # 커밋/PR 메시지 라우팅
    │   ├── frontend_commit_pr_guide.md         # 커밋/PR 작성 가이드
    │   └── frontend_commit_pr_guide.mdc        # 커밋/PR 작성 가이드 (Cursor 형식)
    └── skills/
        ├── frontend-commit-pr-message/         # 커밋/PR 메시지 생성 스킬
        ├── hqn-result-spec-to-checklist/       # 결과 스펙 → 체크리스트 변환
        └── hqn-result-scope-hardcode-token-scan/ # 하드코딩 토큰 스캔
```

---

## 2. Claude Code 관련 파일

### 2.1 CLAUDE.md (행동 규칙서)

| 파일 | 적용 범위 |
|------|---------|
| `/neo/CLAUDE.md` | 저장소 전체 (backend 포함) |
| `/neo/frontend/CLAUDE.md` | HQN Frontend 전용 추가 규칙 |

**`frontend/CLAUDE.md`의 핵심 역할**:

- **자연어 라우팅 정의**: "일해라", "픽업" → `pickup` 흐름 / "마무리", "끝내" → `finish` 흐름
- **ADO 고정값 설정**: Organization `neurophet`, Project `MWA` (NEO 아님)
- **브랜치 규칙**: 항상 `product/hqn/main` 기반에서만 새 작업 브랜치 생성
- **응답 언어**: 기본 한국어

이 파일이 레포에 체크인되어 있어, **클론만 하면 팀 전체가 동일한 AI 워크플로우**를 사용한다.

---

### 2.2 .claude/agents/ (역할별 에이전트)

Claude Code의 서브에이전트 정의 파일들. 각 파일의 frontmatter에 `model`, `disallowedTools`, `skills` 필드를 명시해 **역할별로 다른 모델과 도구 접근 범위**를 부여한다.

| 에이전트 파일 | 모델 | 차단된 도구 (disallowedTools) | 역할 |
|-------------|------|---------|------|
| `planner-opus-4_6.md` | Claude Opus 4.6 | Write, Edit, MultiEdit, ADO MCP 5종 | ADO 조회, 코드베이스 분석, 구현 계획 수립 (Tool usage rules: Serena 우선 하드 규칙 포함) |
| `implementer-sonnet.md` | Claude Sonnet 4.6 | NotebookEdit, ADO MCP 5종 | 실제 코드 구현, 파일 수정, 빌드 검증 |
| `reviewer-opus-4_6.md` | Claude Opus 4.6 | Write, Edit, MultiEdit, ADO MCP 5종 | 변경사항 리뷰, guardrails 준수 확인 |

차단된 ADO MCP 5종: `wit_update_work_item`, `repo_create_branch`, `repo_create_pull_request`, `repo_create_pull_request_thread`, `wit_create_work_item`

**핵심 설계 원칙**: 허용 목록(allowlist) 대신 차단 목록(disallowedTools)으로 설계했다. planner와 reviewer는 Edit/Write가 차단되어 파일을 수정할 수 없다. 모든 에이전트에서 ADO MCP 쓰기 도구가 차단되어, MCP ADO 조작은 메인 오케스트레이터만 가능하다.

**파일 저장 책임**: planner와 reviewer는 결과를 텍스트로 **반환**만 한다. 파일로 저장하는 것은 메인 오케스트레이터의 책임이다.
- planner → 핸드오프 텍스트 반환 → 오케스트레이터가 `.claude/state/handoff.md`에 저장
- reviewer → findings 텍스트 반환 → 오케스트레이터가 `.claude/state/review_findings.md`에 저장

**토큰 효율 설계**:
- 파일 기반 릴레이: 핸드오프/findings를 `.claude/state/` 파일로 전달 → 메인 컨텍스트에 중복 적재 방지
- reviewer는 `git diff` 기반으로 리뷰를 시작한다. 전체 파일을 읽지 않고 diff + Serena 심볼 룩업으로 필요한 맥락만 보충한다.
- 모든 에이전트는 압축된 출력을 반환한다 (lint pass 시 한 줄, 이슈 있을 때만 상세).

---

### 2.3 .claude/skills/ (커스텀 명령어)

Claude Code에서 `/skill명` 또는 자연어로 호출할 수 있는 프로젝트 특화 명령어들.

| 스킬 | 설명 |
|------|------|
| `hqn-ado-pickup-task` | ADO work item 선택 → In Progress 변경 → 작업 브랜치 생성 → 구현 계획 수립 → `implementer-sonnet` 스폰으로 구현 → (선택) finish 흐름 연결 |
| `hqn-ado-finish-task` | 변경사항 리뷰 → 리뷰 verdict에 따라 수정 루프 가능 → 사용자 최종 승인 → 커밋 → push → Draft PR 생성 |
| `hqn-frontend-guardrails` | 소프트 규칙 문서. 커밋 메시지 형식, 허용 경로, ADO 고정값 등 모든 에이전트가 공통 참조 |
| `pickup` | "일해라" 같은 자연어 → `hqn-ado-pickup-task` 단축 진입점 |
| `finish` | "마무리" 같은 자연어 → `hqn-ado-finish-task` 단축 진입점 |
| `tasks` | 할당된 ADO work item 목록만 조회 (상태 변경/브랜치 생성 없음) |

`hqn-frontend-guardrails`는 `disable-model-invocation: true` frontmatter를 가져 LLM 호출 없이 규칙 문서만 Claude 컨텍스트에 로드한다.

---

### 2.4 .claude/hooks/ (자동 안전 게이트)

Claude Code의 훅 시스템을 이용해 **AI가 도구를 호출할 때마다 자동으로 실행**되는 파이썬 스크립트들.

훅은 `settings.local.json`의 `hooks` 필드에 배선되어 있다:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write",   "hooks": [{ "command": "python3 hqn_protect_paths.py" }] },
      { "matcher": "Bash",         "hooks": [{ "command": "python3 hqn_guard_shell.py" }] },
      {
        "matcher": "mcp__azure-devops__wit_update_work_item|mcp__azure-devops__repo_create_branch|mcp__azure-devops__repo_create_pull_request",
        "hooks": [{ "command": "python3 hqn_guard_mcp_ado.py" }]
      }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "command": "python3 hqn_after_edit_context.py" }] }
    ]
  }
}
```

#### `hqn_protect_paths.py` — 경로 보호 (PreToolUse: Edit/Write)

`src/pages/`와 `src/shared/` 경로 수정을 물리적으로 차단한다.

- `src/pages/`: Next.js 라우팅. HQN 변경이 전사 라우팅에 영향을 줄 수 있음
- `src/shared/`: 전사 공유 컴포넌트. 다른 제품 회귀 위험

CLAUDE.md에 "수정하지 마세요"라고 써도 에이전트가 긴 작업 중 잊을 수 있다. 훅은 **매 도구 호출마다 컨텍스트 길이와 무관하게 독립 실행**된다.

#### `hqn_guard_shell.py` — 셸 명령 게이트 (PreToolUse: Bash)

4가지 검사를 순서대로 실행한다:

1. **파괴적 git 명령 차단**: `git reset --hard`, `git push --force`, `git clean -fd` 등
2. **브랜치 생성 유효성**: 브랜치명 패턴 검증 + 현재 브랜치 확인 + HEAD와 origin 일치 여부 + 시작 승인 토큰 유효성
3. **ADO 상태 변경 게이트**: 시작 토큰의 work item 번호와 일치하는 경우만 허용
4. **커밋/푸시/PR 완료 승인**: 완료 토큰 유효성 + 로컬 전용 파일 staged 여부 + Draft PR 필수 옵션 확인

#### `hqn_guard_mcp_ado.py` — MCP ADO 도구 게이트 (PreToolUse: ADO MCP 3종)

`wit_update_work_item`, `repo_create_branch`, `repo_create_pull_request` MCP 도구 호출 직전에 토큰을 검증한다. 시작 작업(브랜치 생성/상태 변경)은 start_approval 토큰, PR 생성은 finish_approval 토큰을 요구한다. 토큰이 없거나 만료/불일치 시 `[GUARD:mcp_*]` 태그와 재발급 명령을 포함한 deny 메시지를 반환한다.

#### `hqn_after_edit_context.py` — 컨텍스트 주입 (PostToolUse: Edit/Write, 세션당 1회)

`src/products/hqn/` 또는 `src/locales/` 파일 수정 후, Claude 컨텍스트에 `yarn lint` + `yarn tsc --noEmit` 실행 리마인더를 주입한다. `.edit_context_injected` 플래그 파일이 있으면 이미 주입된 것으로 간주하고 건너뛰어, 동일 세션에서 반복 편집 시 컨텍스트가 누적되지 않는다. 플래그는 pickup 시작 시 삭제된다.

#### `hqn_start_approval.py` / `hqn_finish_approval.py` — 토큰 발급 CLI

사용자 승인을 JSON 파일로 기록하는 CLI. 훅 스크립트가 이 토큰 파일을 검증해 허용/거부를 결정한다.

---

### 2.5 .claude/state/ (승인 토큰)

| 파일 | TTL | 포함 정보 | 이 토큰이 있어야 하는 것 |
|------|-----|---------|----------------------|
| `hqn_start_approval.json` | 1시간 | repo 경로, branch_type, work_item 번호 | 브랜치 생성(CLI/MCP), ADO 상태 → In Progress(CLI/MCP) |
| `hqn_finish_approval.json` | 2시간 | repo 경로, 브랜치명, work_item 번호 | git commit, git push, PR 생성(CLI/MCP) |
| `.edit_context_injected` | 세션 지속 (플래그 파일) | 없음 | PostToolUse 컨텍스트 주입이 이미 됐음을 표시 |
| `handoff.md` | 영구 (덮어씀) | 플래너 핸드오프 전문 | implementer가 읽어서 구현 |
| `review_findings.md` | 영구 (덮어씀) | 리뷰어 findings 전문 | not ready 시 implementer 재스폰용 |

Claude가 "사용자가 승인했다고 판단"하는 것이 아니라, **토큰 파일이 존재하고 유효할 때만** 위험 작업이 허용된다. 토큰에는 만료 시간, repo, work item 번호가 모두 포함되어 특정 작업에 대한 특정 시간의 승인임을 명확히 한다.

---

### 2.6 .claude/docs/ (분석 및 참조 문서)

워크플로우 설계 문서와 AI 리뷰 분석 문서가 함께 보관된다.

| 파일 | 내용 |
|------|------|
| `CLAUDE_CODE_WORKFLOW.md` | 전체 자동화 워크플로우 상세 가이드 |
| `CLAUDE_CODE_HARNESS_ENGINEERING.md` | 훅/안전게이트 시스템 설계 분석 |
| `CLAUDE_CODE_MODEL_SPLIT.md` | 역할별 모델 분리 전략 상세 분석 |
| `AI_TOOLING_GUIDE.md` | AI 도구 구성 가이드 (이 파일) |
| `CHANGELOG.md` | 워크플로우(에이전트/스킬/훅) 변경 히스토리 |
| `OPUS_47_HQN_CLAUDE_CODE_REVIEW.md` | (사전 개선) Opus 모델 Claude Code 구성 리뷰 |
| `GPT_54_HQN_ADO_AUTOMATION_REVIEW.md` | (사전 개선) GPT 모델 ADO 자동화 리뷰 |
| `composer-2-hqn-ado-workflow-audit.md` | (사전 개선) Cursor Composer 워크플로우 감사 |

`OPUS_47_*`, `GPT_54_*`, `composer-2-*` 세 파일은 현재 구현 이전의 분석 스냅샷으로, 역사적 참조 목적으로만 보관된다.

---

---

## 3. Cursor 관련 파일

### 3.1 .cursor/rules/ (Cursor 규칙)

Cursor IDE가 자동으로 읽는 규칙 파일들. `.mdc` 형식은 frontmatter로 적용 범위를 제어한다.

| 파일 | alwaysApply | 내용 |
|------|------------|------|
| `neo.mdc` | true | NEO Frontend 전체 코딩 규칙 (TypeScript, React, NSDS 토큰, i18n, 금지 사항 등) |
| `hqn_ado_local_router.mdc` | true | HQN ADO 자연어 → 로컬 스킬 라우팅 규칙 |
| `frontend_commit_pr_local_router.mdc` | true | 커밋/PR 메시지 요청 → 스킬 라우팅 규칙 |
| `frontend_commit_pr_guide.md/.mdc` | - | 커밋/PR 작성 가이드 (형식, 이모지-타입 매핑 등) |

**`neo.mdc`의 주요 규칙**:
- `src/pages/`, `src/shared/` 디렉토리 절대 수정 금지
- NSDS 토큰 우선 사용 (하드코딩 색상/폰트/간격 금지)
- i18n: `TID_` 접두사 번역 키 사용
- NSDS 컴포넌트 우선 사용 (`@nsds/nsui3`)
- 함수형 컴포넌트만 사용 (클래스 컴포넌트 금지)

---

### 3.2 .cursor/skills/ (Cursor 스킬)

Cursor Composer에서 호출할 수 있는 프로젝트 특화 스킬들.

| 스킬 | 설명 |
|------|------|
| `frontend-commit-pr-message` | NEO 커밋 컨벤션 형식으로 커밋 메시지 / PR 제목·본문 생성 |
| `hqn-result-spec-to-checklist` | 결과 화면 스펙 문서를 구현 체크리스트로 변환 |
| `hqn-result-scope-hardcode-token-scan` | HQN 결과 화면에서 하드코딩된 스타일 토큰 스캔 |

---

## 4. 자동화 워크플로우 사용법

### 4.1 Claude Code에서 ADO 태스크 시작

```
사용자: 일해라
→ 할당된 work item 목록 표시
→ 번호 선택
→ 확인 게이트 (브랜치명/베이스 브랜치 확인)
→ "네" 입력 시:
   - ADO 상태 → In Progress
   - product/hqn/main 기반 브랜치 생성
   - 코드베이스 분석 (Serena MCP)
   - 구현 계획 수립 (planner-opus-4_6) → 핸드오프를 .claude/state/handoff.md에 저장
   - "구현을 시작할까요?" → implementer-sonnet 스폰으로 구현
   - "바로 리뷰와 커밋을 진행할까요?" → finish 흐름으로 연결 가능
```

### 4.2 구현 완료 후 마무리

```
사용자: 마무리 (또는 pickup에서 자동 연결)
→ 변경사항 diff 기반 리뷰 (reviewer-opus-4_6)
→ reviewer verdict:
   - ready: 사용자 확인 게이트로 이동
   - ready with caveats: caveats 표시 후 사용자 확인
   - not ready: "수정할까요?" → implementer-sonnet 재스폰 → 재리뷰 (1회)
→ 최종 승인 게이트 (변경 파일 목록 확인)
→ "네" 입력 시:
   - NEO 커밋 컨벤션으로 커밋
   - git push
   - Draft PR 생성 (product/hqn/main 타겟)
   - ADO work item 연결
```

### 4.3 자연어 단축어 목록

| 입력 | 동작 |
|------|------|
| `일해라`, `픽업`, `작업 시작`, `태스크 잡아줘` 등 | pickup 흐름 |
| `마무리`, `끝내`, `PR 만들어`, `커밋해` 등 | finish 흐름 |
| `내 태스크`, `일감 보여줘`, `할당 태스크` 등 | tasks 목록만 조회 |

---

## 5. 모델 분리 전략 요약

| 역할 | 모델 | 스폰 여부 | 이유 |
|------|------|---------|------|
| 메인 오케스트레이터 | remote-settings.json 기본값 (보통 Sonnet) | 메인 세션 | 라우팅·에이전트 스폰·결과 전달 등 패턴 인식 중심 작업 |
| planner | Opus 4.6 (agents/planner-opus-4_6.md 고정) | pickup에서 스폰 | 코드베이스 아키텍처 이해, 복잡한 추론, 실수 비용이 큼 |
| implementer | Sonnet 4.6 (agents/implementer-sonnet.md 고정) | pickup/finish에서 스폰 | 파일 읽기·코드 작성 반복, 토큰 소비 많음 |
| reviewer | Opus 4.6 (agents/reviewer-opus-4_6.md 고정) | finish에서 스폰 | 품질 검증은 정확도가 중요 |

Opus는 Sonnet 대비 약 5배 비싸다. 판단이 필요한 곳에만 Opus를 쓰고, 반복 실행 작업은 Sonnet으로 처리해 비용을 절감한다.

**토큰 효율 최적화**:
- 핸드오프/리뷰 결과는 파일(`.claude/state/`)로 릴레이해 메인 컨텍스트 중복 적재 방지
- reviewer는 `git diff` 기반 리뷰로 Opus 토큰 절감
- 모든 에이전트 출력은 압축 형식 (pass 시 한 줄, 이슈 시만 상세)
- Serena MCP(시맨틱 코드 탐색)로 planner(Opus)가 파일 전체 대신 심볼만 읽어 실측 기준 약 8~9배 토큰 절감
- Verification은 변경 파일만 대상으로 scoped lint 우선 적용

---

## 6. 안전 게이트 레이어 구조

| 레이어 | 구현 방식 | Claude가 우회 가능한가 | 보호 대상 |
|-------|---------|-------------------|---------|
| PreToolUse 훅 (경로) | Python 스크립트 | 불가 | src/pages, src/shared 수정 |
| PreToolUse 훅 (셸) | Python 스크립트 | 불가 | 파괴적 git 명령, 무단 브랜치 생성, 무단 커밋/PR |
| PostToolUse 훅 | Python 스크립트 | 해당 없음 (정보 주입) | 검증 없는 "완료" 선언 |
| 승인 토큰 시스템 | JSON 상태 파일 | 불가 (훅이 검증) | 사용자 확인 없는 위험 작업 |
| Skill / CLAUDE.md | 지시 문서 | 가능 (소프트 제약) | 커밋 형식, 코딩 스타일 등 |
| planner 에이전트 지침 | agents/planner-opus-4_6.md | 가능 (소프트 제약) | Serena 우선 규칙, 파일 읽기 전략, 아이콘 prop 검증 |

**설계 기준**: 절대 허용하면 안 되는 것은 훅에, 지키면 좋지만 상황에 따라 유연해야 하는 것은 Skill에 분리한다.
