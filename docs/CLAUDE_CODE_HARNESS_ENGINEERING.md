# HQN Frontend 하네스 엔지니어링 분석

> 작성일: 2026-04-23
> 분석 대상: `/Users/cheesu/IdeaProjects/neo/frontend/.claude/`

---

## 핵심 요약

이 프로젝트의 하네스는 **6개 레이어**로 구성된다.
Claude의 "의지"와 무관하게 물리적으로 막는 레이어(훅)와, Claude가 지키도록 유도하는 레이어(CLAUDE.md, skill)를 함께 쓰며, 중요도에 따라 어느 레이어에 규칙을 두는지가 명확히 분리되어 있다.

| 레이어 | 종류 | Claude가 우회 가능한가 |
|-------|------|-------------------|
| 1. PreToolUse 훅 | 경로 보호 | 불가 |
| 2. PreToolUse 훅 | 셸 명령 게이트 | 불가 |
| 3. PreToolUse 훅 | MCP ADO 도구 게이트 | 불가 |
| 4. PostToolUse 훅 | 컨텍스트 주입 (세션당 1회) | 해당 없음 (정보 주입) |
| 5. 승인 토큰 시스템 | 상태 파일 | 불가 (훅이 검증) |
| 6. Skill / CLAUDE.md | 지시 문서 | 가능 (소프트 제약) |

---

## 1. 파일 구조

```
frontend/.claude/
├── settings.local.json          ← 훅 배선 + 권한 설정
├── agents/
│   ├── planner-opus-4_6.md      ← Opus 전용 플래너 에이전트
│   ├── implementer-sonnet.md    ← Sonnet 전용 구현 에이전트
│   └── reviewer-opus-4_6.md    ← Opus 전용 리뷰어 에이전트
├── skills/
│   ├── hqn-frontend-guardrails/ ← 소프트 제약 규칙 문서
│   ├── hqn-ado-pickup-task/     ← 태스크 픽업 플로우
│   ├── hqn-ado-finish-task/     ← 태스크 완료 플로우
│   ├── pickup/                  ← 자연어 단축어 → pickup
│   ├── finish/                  ← 자연어 단축어 → finish
│   └── tasks/                   ← 할당 태스크 목록 조회
├── hooks/scripts/
│   ├── hqn_protect_paths.py      ← PreToolUse: 경로 차단
│   ├── hqn_guard_shell.py        ← PreToolUse: 셸 명령 게이트
│   ├── hqn_guard_mcp_ado.py      ← PreToolUse: MCP ADO 도구 게이트
│   ├── hqn_after_edit_context.py ← PostToolUse: 컨텍스트 주입 (세션당 1회)
│   ├── hqn_start_approval.py     ← 시작 토큰 발급 CLI
│   ├── hqn_finish_approval.py    ← 완료 토큰 발급 CLI
│   └── hqn_session_log.py        ← 세션 토큰/툴 사용량 분석 CLI
└── state/
    ├── hqn_start_approval.json   ← 시작 승인 토큰 (TTL: 1시간)
    ├── hqn_finish_approval.json  ← 완료 승인 토큰 (TTL: 2시간)
    ├── handoff.md                ← 플래너 핸드오프 (오케스트레이터가 저장)
    ├── review_findings.md        ← 리뷰어 findings (오케스트레이터가 저장)
    ├── .edit_context_injected    ← 세션당 PostToolUse 컨텍스트 주입 플래그
    └── complexity_verdict.txt    ← 태스크 복잡도 판정 결과 (light/standard)
```

---

## 2. 레이어별 상세 분석

### 2.1 PreToolUse 훅: 경로 보호 (`hqn_protect_paths.py`)

**트리거**: Edit, Write, MultiEdit 도구 호출 직전

**동작**:
```python
FORBIDDEN_PREFIXES = [
    FRONTEND_ROOT / 'src' / 'pages',
    FRONTEND_ROOT / 'src' / 'shared',
]
```
대상 파일 경로가 `src/pages/` 또는 `src/shared/` 아래이면 `permissionDecision: "deny"` 를 반환한다. Claude Code는 이 응답을 받으면 도구 실행을 취소하고 거절 사유를 Claude 컨텍스트에 주입한다.

**보호 대상과 이유**:
- `src/pages/`: Next.js Pages Router. HQN 제품 작업이 전사 라우팅을 건드리면 다른 제품에 영향
- `src/shared/`: 전사 공유 컴포넌트/훅. HQN 단독 변경 시 다른 제품 회귀 위험

**특징**: 경로 체크는 절대경로로 resolve해서 심볼릭 링크나 `../` 우회를 막는다.

---

### 2.2 PreToolUse 훅: 셸 명령 게이트 (`hqn_guard_shell.py`)

**트리거**: Bash 도구 호출 직전

이 스크립트가 하네스의 핵심이다. 아래 4개 검사를 순서대로 실행한다.

#### 검사 1: 파괴적 git 명령 차단
```python
DESTRUCTIVE_PATTERNS = [
    re.compile(r'(^|[;&\s])git\s+reset\s+--hard(\s|$)', re.IGNORECASE),
    re.compile(r'(^|[;&\s])git\s+checkout\s+--(\s|$)', re.IGNORECASE),
    re.compile(r'(^|[;&\s])git\s+clean\s+-f[dx]?(\s|$)', re.IGNORECASE),
    re.compile(r'(^|[;&\s])git\s+push(?:\s+\S+)*\s+--force(\s|$)', re.IGNORECASE),
    re.compile(r'(^|[;&\s])git\s+push(?:\s+\S+)*\s+-f(\s|$)', re.IGNORECASE),
    # Force-delete local branch (git branch -D <name>)
    re.compile(r'(^|[;&\s])git\s+branch\s+(-D|--delete\s+-f|--delete\s+--force)\s+\S', re.IGNORECASE),
    # Delete remote branch via refspec (git push origin :branch)
    re.compile(r'(^|[;&\s])git\s+push\s+\S+\s+:\S', re.IGNORECASE),
]
```
정규식으로 명령어 패턴을 검사한다. 매칭되면 즉시 deny.

#### 검사 2: 브랜치 생성 유효성
`git checkout -b` 또는 `git switch -c` 가 포함된 명령에 대해 다음을 모두 통과해야 허용한다:

```
① 브랜치명이 product/hqn/{type}/{숫자} 패턴인가?
② 브랜치 생성 명령이 && ; || 로 다른 명령과 묶여 있지 않은가?
   → compound command로 checkout + branch 생성을 한 번에 하면 차단
③ 현재 브랜치가 product/hqn/main 인가?
④ 워킹트리가 clean 한가? (git status --short 결과 확인)
⑤ HEAD가 origin/product/hqn/main 과 동일한가?
   → git rev-parse HEAD == git rev-parse origin/product/hqn/main
⑥ start_approval 토큰이 유효한가?
   → state 파일 확인: repo 경로, branch_type, work_item 번호, 만료시간 모두 일치해야 함
```

#### 검사 3: ADO work item 상태 변경 차단
`az boards work-item update` 명령에 대해 start_approval 토큰의 work_item 번호와 일치하는지 확인. 불일치 또는 토큰 없으면 deny.

#### 검사 4: 커밋/푸시/PR 완료 승인 확인
`git commit`, `git push`, `az repos pr create` 에 대해:

```
① finish_approval 토큰이 유효한가?
   → repo 경로, 브랜치명, 만료시간 확인
② 현재 브랜치가 product/hqn/{type}/{숫자} 패턴인가?
③ staged 파일 중 로컬 전용 파일이 있는가?
   → .serena/project.yml, PR_MESSAGE.md 등 커밋되면 안 되는 파일 목록
```

PR 생성 추가 검사:
```
④ --target-branch product/hqn/main 이 있는가?
⑤ --draft 플래그가 있는가?
```

---

### 2.3 PostToolUse 훅: 컨텍스트 주입 (`hqn_after_edit_context.py`)

**트리거**: Edit, Write, MultiEdit 도구 완료 직후, 대상 파일이 `src/products/hqn/` 또는 `src/locales/` 아래일 때

**동작**:
```python
INJECTED_FLAG = FRONTEND_ROOT / '.claude' / 'state' / '.edit_context_injected'

def main() -> int:
    # ...경로 체크...
    if INJECTED_FLAG.exists():
        return 0  # 이미 이번 세션에서 주입됨 → 조용히 통과
    INJECTED_FLAG.parent.mkdir(parents=True, exist_ok=True)
    INJECTED_FLAG.touch()
    # 컨텍스트 주입: lint + yarn tsc --noEmit 실행 리마인더
```

**세션당 1회 동작**: `.edit_context_injected` 플래그 파일이 존재하면 주입을 건너뛴다. 동일 세션에서 파일을 수백 번 수정해도 Claude 컨텍스트에 동일한 리마인더가 반복 적재되지 않는다. 플래그는 pickup 시작 시 삭제되어 새 작업 세션이 시작되면 다시 1회 주입된다.

Claude의 컨텍스트에 검증 리마인더를 주입한다. deny가 아니라 정보 주입이므로 작업을 막지는 않고, Claude가 파일 수정 후 즉시 "완료"를 선언하지 않도록 유도한다.

---

### 2.4 PreToolUse 훅: MCP ADO 도구 게이트 (`hqn_guard_mcp_ado.py`)

**트리거**: `mcp__azure-devops__wit_update_work_item`, `mcp__azure-devops__repo_create_branch`, `mcp__azure-devops__repo_create_pull_request` 호출 직전

MCP 도구는 Bash 도구가 아니므로 `hqn_guard_shell.py`가 실행되지 않는다. 이 스크립트가 MCP 경로의 ADO 조작을 별도로 차단한다.

```python
START_APPROVAL_TOOLS = {
    'mcp__azure-devops__wit_update_work_item',
    'mcp__azure-devops__repo_create_branch',
}
FINISH_APPROVAL_TOOLS = {
    'mcp__azure-devops__repo_create_pull_request',
}

def main() -> int:
    tool_name = input_data.get('tool_name', '')
    if tool_name in START_APPROVAL_TOOLS:
        # start_approval 토큰 검증 (repo, branch_type, work_item, 만료시간)
    elif tool_name in FINISH_APPROVAL_TOOLS:
        # finish_approval 토큰 검증 (repo, branch, 만료시간)
```

토큰이 없거나 만료됐거나 다른 work item에 대한 토큰이면 `[GUARD:mcp_start_approval]` 또는 `[GUARD:mcp_completion_approval]` 태그와 함께 deny. 재발급 명령도 deny 메시지에 포함되어 Claude가 즉시 재시도할 수 있다.

**설계 의도**: Bash 훅(guard_shell.py)이 막는 `az repos pr create` 같은 CLI 명령과 MCP PR 생성 도구(`repo_create_pull_request`) 사이에 있던 승인 검증 공백을 제거한다.

---

### 2.5 승인 토큰 시스템

훅이 허용/거부를 판단하는 근거. JSON 상태 파일로 구현되어 있다.

#### start_approval (시작 토큰)
```json
{
  "repo": "/Users/cheesu/IdeaProjects/neo",
  "branch_type": "feature",
  "work_item": "68900",
  "approved_at": 1745100000,
  "expires_at": 1745103600   ← 승인 후 1시간
}
```

발급 명령:
```bash
python3 hqn_start_approval.py approve \
  --repo /Users/cheesu/IdeaProjects/neo \
  --branch-type feature \
  --work-item 68900
```

이 토큰이 있어야 하는 것들:
- `git checkout -b product/hqn/feature/68900`
- `az boards work-item update --id 68900 ...`

#### finish_approval (완료 토큰)
```json
{
  "repo": "/Users/cheesu/IdeaProjects/neo",
  "branch": "product/hqn/feature/68900",
  "work_item": "68900",
  "approved_at": 1745110000,
  "expires_at": 1745117200   ← 승인 후 2시간
}
```

이 토큰이 있어야 하는 것들:
- `git commit ...`
- `git push ...`
- `az repos pr create ...`

**설계 포인트**: TTL이 다르다. 시작 토큰(1시간)은 브랜치 생성 직후에만 쓰이므로 짧고, 완료 토큰(2시간)은 구현 완료 후 리뷰와 커밋까지 시간이 필요하므로 더 길다.

---

### 2.6 소프트 제약: `hqn-frontend-guardrails` 스킬

**특이점**: frontmatter에 `disable-model-invocation: true` 가 있다. 이 스킬은 에이전트를 새로 스폰하거나 LLM 호출을 발생시키지 않고, **순수하게 규칙 문서를 Claude 컨텍스트에 로드**하는 역할만 한다.

모든 에이전트(planner, implementer, reviewer)가 `skills: [hqn-frontend-guardrails]`를 선언하고 있어, 세 에이전트 모두 동일한 규칙 문서를 참조한다.

**포함된 규칙**:
- 편집 금지 경로 (src/pages, src/shared)
- 허용 브랜치 패턴
- 커밋/PR 제목 형식 (`[HQN][FE]✨feat: ...`)
- 이모지-타입 매핑 테이블
- Serena 우선 사용 지침 (토큰 효율)
- ADO 조직/프로젝트 고정값
- 사용자 응답 언어 (기본 한국어)

훅으로는 막기 어렵거나 막을 필요가 없는 규칙들 — 커밋 메시지 형식, 코딩 스타일, Serena 사용 순서 등 — 을 이곳에 집중시킨다.

---

### 2.7 훅 배선: `settings.local.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "command": "python3 hqn_protect_paths.py", "timeout": 30 }]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "command": "python3 hqn_guard_shell.py", "timeout": 30 }]
      },
      {
        "matcher": "mcp__azure-devops__wit_update_work_item|mcp__azure-devops__repo_create_branch|mcp__azure-devops__repo_create_pull_request",
        "hooks": [{ "command": "python3 hqn_guard_mcp_ado.py", "timeout": 30 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "command": "python3 hqn_after_edit_context.py", "timeout": 30 }]
      }
    ]
  }
}
```

`matcher` 필드로 어떤 도구에 훅이 걸릴지를 제어한다. Read, Glob, Grep 같은 읽기 전용 도구는 훅 대상이 아니다. MCP 도구는 도구 이름 전체를 `|`로 열거해서 매칭한다.

---

## 3. 훅과 Skill의 역할 분담

| 규칙 | 어디서 강제하는가 | 이유 |
|------|----------------|------|
| src/pages 수정 금지 | 훅 (protect_paths) | 절대 허용하면 안 됨 |
| src/shared 수정 금지 | 훅 (protect_paths) | 절대 허용하면 안 됨 |
| git reset --hard 금지 | 훅 (guard_shell) | 되돌릴 수 없는 파괴적 명령 |
| force push 금지 | 훅 (guard_shell) | 공유 브랜치 파괴 위험 |
| git branch -D 금지 | 훅 (guard_shell) | 로컬 작업 브랜치 강제 삭제 방지 |
| git push origin :브랜치 금지 | 훅 (guard_shell) | 원격 브랜치 삭제(refspec delete) 방지 |
| 브랜치 베이스 검증 | 훅 (guard_shell) | 잘못된 베이스는 나중에 발견하기 어려움 |
| 사용자 승인 없이 브랜치 생성 금지 (CLI) | 훅 + 토큰 시스템 (guard_shell) | 사용자 의사를 코드로 증명 |
| 사용자 승인 없이 ADO MCP로 브랜치/PR 생성 금지 | 훅 + 토큰 시스템 (guard_mcp_ado) | CLI 경로와 동일한 보호를 MCP 경로에도 적용 |
| 커밋 전 사용자 확인 | 훅 + 토큰 시스템 | 커밋은 되돌리기 어려움 |
| Draft PR만 허용 | 훅 (guard_shell) | 실수로 정식 PR 오픈 방지 |
| 로컬 전용 파일 커밋 방지 | 훅 (guard_shell) | .serena/project.yml 등 노출 방지 |
| 커밋 메시지 형식 | Skill (guardrails) | 형식 틀려도 작업 자체는 유효 |
| Serena 우선 사용 (guardrails) | Skill (guardrails) | 소프트 권고: 강제보다 유도가 적절 |
| Serena 하드 규칙 (planner) | agents/planner-opus-4_6.md 에이전트 지침 | planner에서 심볼 검색 시 Grep 명시적 금지. 2026-04-30 세션 낭비 분석 후 추가 |
| 이모지 타입 매핑 | Skill (guardrails) | 훅으로 검증하기 복잡, 소프트로 충분 |
| 한국어 응답 | Skill (guardrails) | 강제할 필요 없음 |

---

## 4. 전체 흐름에서 하네스의 동작 시퀀스

```
사용자: "일해라"
        │
        ▼
[CLAUDE.md 라우팅] → pickup 스킬 실행
        │
        ▼
ADO work item 목록 표시 → 사용자 선택 → 확인
        │
        ▼
hqn_start_approval.py approve --branch-type feature --work-item 68900
→ state/hqn_start_approval.json 생성 (TTL 1시간)
        │
        ▼
git checkout product/hqn/main  (Bash 훅 통과: 브랜치 생성 아님)
git pull --ff-only origin product/hqn/main  (훅 통과)
git rev-parse HEAD  (훅 통과: 읽기 전용)
        │
        ▼
git checkout -b product/hqn/feature/68900  ← Bash 훅 실행
        ┌─────────────────────────────────────────────┐
        │ guard_shell 검사:                            │
        │ ① 브랜치명 패턴 일치: ✓                      │
        │ ② compound command 아님: ✓                  │
        │ ③ 현재 브랜치 = product/hqn/main: ✓         │
        │ ④ 워킹트리 clean: ✓                         │
        │ ⑤ HEAD == origin/product/hqn/main: ✓        │
        │ ⑥ start_approval 토큰 유효: ✓               │
        └─────────────────────────────────────────────┘
        → 허용
        │
        ▼
planner-opus-4_6 에이전트 스폰 → 구현 계획 반환
→ .claude/state/handoff.md 에 핸드오프 저장
        │
        ▼
사용자 확인: "구현을 시작할까요?"
        │
        ▼
implementer-sonnet 에이전트 스폰 (.claude/state/handoff.md 읽고 실행)
        │
        ▼
파일 수정 시 (Edit 도구) ← hqn_protect_paths 실행
        ┌─────────────────────────┐
        │ 대상: src/products/hqn/ │ → 허용
        │ 대상: src/pages/        │ → 차단
        └─────────────────────────┘
파일 수정 후 (PostToolUse) ← hqn_after_edit_context 실행
→ "검증 먼저 실행하세요" 컨텍스트 주입
        │
        ▼
yarn lint 실행 (훅 통과: 파괴적 명령 아님)
        │
        ▼
사용자 확인: "바로 리뷰와 커밋을 진행할까요?" (또는 별도 "마무리")
        │
        ▼
reviewer-opus-4_6 에이전트 스폰 (git diff 기반 리뷰)
        │
        ├─ verdict: ready → 최종 확인 요청
        ├─ verdict: ready with caveats → caveats 표시 → 최종 확인 요청
        └─ verdict: not ready → 사용자에게 수정 여부 확인
              └─ "수정해줘" → implementer-sonnet 재스폰
                 (.claude/state/review_findings.md + handoff.md 읽고 수정)
                 → reviewer-opus-4_6 재스폰 (1회 재시도 제한)
        │
        ▼
hqn_finish_approval.py approve --branch product/hqn/feature/68900
→ state/hqn_finish_approval.json 생성 (TTL 2시간)
        │
        ▼
git add ... && git commit -m "[HQN][FE]✨feat: ..."  ← Bash 훅 실행
        ┌─────────────────────────────────────────────┐
        │ guard_shell 검사:                            │
        │ ① 브랜치명 패턴 일치: ✓                      │
        │ ② 로컬 전용 파일 staged 없음: ✓             │
        │ ③ finish_approval 토큰 유효: ✓              │
        └─────────────────────────────────────────────┘
        → 허용
        │
        ▼
git push origin product/hqn/feature/68900  ← Bash 훅 (finish_approval 재확인)
az repos pr create --draft --target-branch product/hqn/main  ← Bash 훅
        ┌─────────────────────────────────────────────┐
        │ ① --target-branch product/hqn/main 있음: ✓  │
        │ ② --draft 있음: ✓                           │
        │ ③ finish_approval 유효: ✓                   │
        └─────────────────────────────────────────────┘
        → 허용 → Draft PR 생성
```

---

## 5. 장점

### 5.1 규칙이 명령이 아닌 코드로 강제된다

CLAUDE.md에 "src/pages는 수정하지 마세요"라고 쓰는 것과 훅으로 막는 것은 근본적으로 다르다. 지시문은 Claude가 무시하거나 잊을 수 있다. 특히 에이전트가 여러 단계를 거치면서 컨텍스트가 희석되는 경우, 초반에 읽은 지시가 후반 동작에 반영되지 않는 경우가 실제로 발생한다. 훅은 매 도구 호출마다 독립적으로 실행되기 때문에 컨텍스트 길이와 무관하게 동작한다.

### 5.2 에이전트 전체에 일관성이 보장된다

planner, implementer, reviewer 세 에이전트가 각각 독립 컨텍스트로 실행되는데, 훅은 어떤 에이전트가 도구를 호출하든 동일하게 적용된다. 에이전트별로 규칙을 중복 정의할 필요가 없다.

### 5.3 승인이 의도가 아닌 상태로 증명된다

토큰 시스템은 사용자의 "네"라는 응답을 JSON 파일에 기록한다. Claude가 "사용자가 승인했다고 판단"하는 것이 아니라, 토큰 파일이 존재하고 유효할 때만 허용된다. Claude의 추론 오류나 컨텍스트 오해로 인한 오인 승인이 원천 차단된다. 토큰에는 만료 시간, repo 경로, work item 번호가 모두 포함되어 특정 작업에 대한 특정 시간의 승인임을 명확히 한다.

### 5.4 복합 명령 분리 강제

`git checkout product/hqn/main && git pull && git checkout -b feature/xxx` 같은 compound command를 차단한다. 각 단계를 별도 명령으로 실행하도록 강제함으로써, 베이스 브랜치 검증이 실제로 통과된 이후에만 브랜치가 생성됨을 보장한다. compound command를 허용하면 검증 단계가 실패해도 다음 명령이 이어 실행될 수 있다.

### 5.5 로컬 전용 파일 유출 방지

`.serena/project.yml`, `PR_MESSAGE.md` 등 추적되면 안 되는 파일이 staged 상태로 커밋되는 것을 훅이 커밋 직전에 차단한다. `.gitignore`로 충분하지 않은 경우(이미 tracked 되거나 의도치 않게 staged된 경우)에도 동작한다.

### 5.6 하드/소프트 규칙의 계층이 명확하다

절대 허용하면 안 되는 것은 훅에, 지키면 좋지만 상황에 따라 유연해야 하는 것은 skill에 분리한다. 규칙의 강도가 구현 방식으로 드러난다.

---

## 6. 단점 및 한계

### 6.1 경로가 하드코딩되어 있다

```python
FRONTEND_ROOT = Path('/Users/cheesu/IdeaProjects/neo/frontend').resolve()
```

스크립트 전체에 절대 경로가 박혀 있다. 개발 환경이 바뀌거나 (macOS → Linux, 다른 사용자, 다른 clone 경로), 새 팀원이 다른 경로에 클론하면 훅이 조용히 작동하지 않는다. 잘못된 경로일 때 경고나 에러 없이 그냥 통과(`return 0`)하기 때문에 보호가 무력화된 것을 모를 수 있다.

### 6.2 (수정됨) 훅 예외 시 fail-safe / fail-open 분리 적용

**이전 상태**: 훅이 예상치 못한 예외로 종료될 때 동작이 불명확했다. Python 프로세스가 exit code 1로 비정상 종료되면 Claude Code가 이를 허용으로 처리하는 경우가 있어, 보호 훅이 조용히 무력화될 위험이 있었다.

**현재 상태**: 훅 역할에 따라 fail mode를 분리했다.

- **guard 훅 3종 (fail-safe)**: `hqn_guard_shell.py`, `hqn_protect_paths.py`, `hqn_guard_mcp_ado.py`
  — `__main__` 진입부를 `try/except Exception`으로 감싸, 예외 발생 시 `[GUARD:error]` 메시지와 함께 `permissionDecision: deny`를 반환한다. 훅이 깨져도 액션이 통과되지 않는다.

- **컨텍스트 주입 훅 (fail-open)**: `hqn_after_edit_context.py`
  — 예외 발생 시 `sys.exit(0)`으로 조용히 통과한다. 이 훅은 보안 게이트가 아니라 알림용이므로 실패해도 작업을 막을 이유가 없다.

### 6.3 매 도구 호출마다 Python 프로세스가 실행된다

Edit, Write, Bash 도구가 호출될 때마다 Python 프로세스가 fork된다. 구현 단계에서 파일 수정이 빈번하게 일어날 때 오버헤드가 누적된다. 실제 체감 지연은 작업 강도에 따라 다르지만, 훅 스크립트가 복잡해질수록 (특히 `hqn_guard_shell.py`의 `subprocess.run(['git', ...])` 호출들) 누적 지연이 커진다.

### 6.4 토큰 TTL이 고정값이다

시작 토큰 1시간, 완료 토큰 2시간이 코드에 기본값으로 박혀 있다. 복잡한 태스크가 TTL을 초과하면 토큰이 만료되어 다시 발급받아야 한다. 반대로 짧은 작업이면 2시간짜리 완료 토큰이 과하다. 만료됐을 때 훅이 주는 에러 메시지가 원인을 즉시 알려주지 않아 원인 파악이 번거롭다.

### 6.5 훅이 settings.local.json에 묶여 있다

훅 배선은 `.claude/settings.local.json`에 있고, 이 파일은 `git ls-files`로 추적되지만 팀 전체가 동일한 환경이어야 의미가 있다. 새 팀원이 이 설정 파일의 존재를 모르면 훅 없이 작업하게 되고, 하네스 전체가 본인에게는 적용되지 않는다는 것을 모를 수 있다.

### 6.6 (수정됨) MCP ADO 경로 방어 — `hqn_guard_mcp_ado.py`로 해결

**이전 상태**: `hqn_guard_shell.py`의 ADO 상태 변경 검사는 `az boards work-item update` CLI 명령에만 적용됐다. MCP 도구(`mcp__azure-devops__wit_update_work_item`)는 Bash 호출이 아니므로 훅이 실행되지 않아, MCP 경로로 토큰 검증 없이 ADO 상태 변경이 가능한 공백이 있었다.

**현재 상태**: `hqn_guard_mcp_ado.py`가 추가됐다. `settings.local.json`의 세 번째 PreToolUse 훅으로 배선되어, MCP ADO 도구가 호출될 때마다 해당 토큰을 검증한다.

- `wit_update_work_item`, `repo_create_branch`: start_approval 토큰 검증
- `repo_create_pull_request`: finish_approval 토큰 검증

에이전트 정의 파일(planner, implementer, reviewer)에도 이 세 도구가 `disallowedTools`로 추가되어, 서브에이전트가 직접 MCP ADO 도구를 호출하는 것을 도구 레벨에서 원천 차단한다. MCP ADO 도구는 메인 오케스트레이터만 호출할 수 있으며, 오케스트레이터도 훅 승인 토큰 검증을 통과해야 한다.

### 6.7 (수정됨) Guard shell의 compound command 감지 — `\n` 추가

**이전 상태**: `&&`, `;`, `||` 기호만 감지하여 개행(`\n`)으로 연결된 멀티라인 명령은 차단되지 않았다.

**현재 상태**: `'\n' in effective_command` 조건을 추가했다.

```python
def branch_creation_uses_compound_git_chain(command: str) -> bool:
    effective_command = strip_leading_cd_wrapper(command)
    return (
        '&&' in effective_command
        or ';' in effective_command
        or '||' in effective_command
        or '\n' in effective_command
    )
```

**남은 한계**: 문자열 리터럴 내부의 `&&` (예: grep 패턴 `'foo && bar'`)와 실제 셸 체이닝을 구분하지 못한다. 브랜치 생성(`git checkout -b`, `git switch -c`) 명령에 `&&` 패턴이 포함된 인자를 쓰는 경우는 실제로 드물어 오탐 위험은 낮다.

---

## 7. 종합 평가

### 잘 설계된 부분

- **훅 vs Skill 역할 분담**: 무엇을 훅으로, 무엇을 지시 문서로 두는지 일관된 기준이 있다
- **토큰 시스템**: 사용자 의도를 파일로 증명하는 방식은 Claude의 추론 오류에 독립적이다
- **에이전트 disallowedTools**: planner/reviewer에 Edit/Write/ADO MCP를 차단하는 것은 훅 바깥의 가장 근본적인 안전장치다
- **MCP + CLI 대칭 보호**: ADO 조작 경로가 CLI(`az`)든 MCP든 동일한 토큰 검증이 적용된다
- **compound command 차단**: 베이스 브랜치 검증을 건너뛸 수 있는 경로를 미리 막는다
- **로컬 전용 파일 staged 검사**: .gitignore로 해결하기 어려운 케이스를 커버한다
- **PostToolUse 세션당 1회 주입**: 반복 편집 시 컨텍스트 누적 없이 리마인더 효과 유지

### 보완이 필요한 부분

- 경로 하드코딩 → 환경 변수나 설정 파일로 추출
- ~~훅 예외 시 명시적 경고~~ → **(2026-04-30 적용)** guard 훅 3종 fail-safe, 컨텍스트 훅 fail-open으로 분리. 예외 시 guard는 `[GUARD:error]` deny 반환.
- TTL 만료 에러 메시지 개선 → 어떤 토큰이 왜 만료됐는지 명시 (현재는 `[GUARD:*]` 태그로 일부 개선됨)

### 현실적인 효용

이 수준의 하네스는 AI 에이전트가 장시간 자율적으로 작업할 때 사람 개입 없이 잘못된 방향으로 흘러가는 것을 방지하는 데 실질적으로 유효하다. 특히 multi-agent 구조에서 각 에이전트가 독립 컨텍스트로 실행되는 특성상, CLAUDE.md 지시문만으로는 모든 에이전트가 일관되게 규칙을 지킨다고 보장할 수 없다. 훅은 그 갭을 메운다.

다만 훅은 보조 안전망이지 설계 품질을 대체하지 않는다. 훅이 있다고 해서 플래너의 구현 계획이 좋거나, 구현체가 정확하거나, 리뷰어가 실수를 잡는다는 보장은 없다.
