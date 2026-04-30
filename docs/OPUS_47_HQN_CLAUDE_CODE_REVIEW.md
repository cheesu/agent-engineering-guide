# HQN Claude Code 자동화 구조 분석 리포트 (Opus 4.7)

> 대상: `/Users/cheesu/IdeaProjects/neo/frontend/.claude/` + `.cursor/rules/hqn_*`
> 관점: 개선 여지, 리스크 수준, 토큰 비용

---

## 0. 전체 아키텍처 요약

```
사용자 자연어(픽업/마무리/tasks)
  ↓ (라우팅: .cursor/rules/hqn_ado_local_router.mdc + frontend/CLAUDE.md)
Skills (alias: pickup / finish / tasks) → 본 skill(hqn-ado-pickup-task / hqn-ado-finish-task)
  ↓ (항상 hqn-frontend-guardrails 선로딩)
Agents (planner-opus-4_6 → implementer-sonnet → reviewer-opus-4_6)
  ↓
Hooks
  - PreToolUse  : hqn_guard_shell.py (Bash), hqn_protect_paths.py (Edit|Write)
  - PostToolUse : hqn_after_edit_context.py (Edit|Write)
  ↓
State tokens (TTL 기반)
  - hqn_start_approval.json  (TTL 1h)
  - hqn_finish_approval.json (TTL 2h)
```

강점은 **"사용자 승인 → 토큰 파일 기록 → 훅에서 git/commit/PR 차단"** 이중 게이트 구조. 이 골격은 견고하다.

---

## 1. 반드시 고쳐야 하는 실제 리스크 (High)

### 🔴 R1. 훅이 Bash만 지키고 MCP 호출은 전혀 검증하지 않음

- `hqn_guard_shell.py`는 PreToolUse `matcher: "Bash"`에만 붙어 있음.
- 현재 허용된 MCP 도구 중 우회 가능 경로:
  - `mcp__azure-devops__wit_update_work_item` (상태 변경)
  - `mcp__azure-devops__repo_create_pull_request` (PR 생성)
  - `mcp__azure-devops__repo_create_branch` (브랜치 생성)
- `validate_work_item_state_update`는 `az boards work-item update` 문자열만 찾고, `validate_pr_create`도 `az repos pr create` 문자열만 검사 → **MCP는 그대로 통과**.
- skill 문구는 "MCP 우선" 이므로 실제 실행 경로가 대부분 검증 없이 간다.

**리스크 수준**: 높음
**개선안**:
1. 훅 matcher에 `Bash|mcp__azure-devops__.*` 추가 (Claude Code 훅은 정규식 매처 지원).
2. `hqn_guard_shell.py` 진입부에 도구명 분기:
   ```python
   tool_name = event.get('tool_name', '')




   
   tool_input = event.get('tool_input', {}) or {}
   if tool_name.startswith('mcp__azure-devops__'):
       return validate_mcp_ado(tool_name, tool_input)
   ```
3. `wit_update_work_item` → `start_approval.work_item` 과 input의 `id`가 매치할 때만 허용.
4. `repo_create_pull_request` → `target` 브랜치가 `product/hqn/main`인지, `isDraft: true`인지, `finish_approval` 유효한지 검증.
5. `repo_create_branch` → skill에 "MCP로 브랜치 만들지 말고 git CLI만 쓰기" 규칙 추가 **또는** 훅에서 이름/base 검증. 실무적으로는 권한 자체를 빼는 게 가장 깔끔.

---

### 🔴 R2. 브랜치 생성 우회 경로가 여럿 열려 있음

`extract_created_branches`가 잡는 패턴은 `git checkout -b` / `git switch -c` 뿐. 다음은 모두 패턴 밖:

- `git branch product/hqn/fix/123 product/hqn/main && git checkout product/hqn/fix/123`
- `git worktree add -b product/hqn/feature/123 ../wt product/hqn/main`
- `git update-ref refs/heads/foo ...`
- MCP `repo_create_branch`
- subshell: `(git checkout -b foo)` — `(` 로 열리면 현재 regex 못 잡음

**리스크 수준**: 중~높음
**개선안**:
- regex 확장: `git\s+(?:branch|worktree\s+add(?:\s+\S+)*\s+-b|switch\s+-c|checkout\s+-b)`
- 혹은 로직 반전: "현재 브랜치가 `product/hqn/main`이 아니거나 approval이 없으면, `git checkout/switch/branch/worktree` 명령 안에 HQN 브랜치 이름이 등장하면 차단".

---

### 🔴 R3. `rm -rf`, `git branch -D`, `git reflog expire` 등 파괴적 명령 누락

현재 `DESTRUCTIVE_PATTERNS`:
- `git reset --hard`
- `git checkout --`
- `git clean -fd`
- `git push -f / --force`

미포함 (전부 통과):
- `git branch -D product/hqn/fix/69064` (작업 브랜치 로컬 삭제)
- `git push origin :product/hqn/fix/69064` (원격 브랜치 삭제)
- `git update-ref -d`
- `git reflog expire --expire=now --all && git gc --prune=now`
- `rm -rf src/products/hqn/...` (frontend 하위)

**리스크 수준**: 중
**개선안**: 위 패턴 추가. 특히
- `git\s+push\s+\S+\s+:` (원격 삭제)
- `git\s+branch\s+-D`
- `\brm\s+-rf\b` (frontend cwd 하위에서만 차단해도 충분)

---

### 🔴 R4. `yarn tsc` 검증이 기본 베이스라인에서 빠짐

- guardrails / finish skill 모두 "최소 `yarn lint`"만 요구.
- Next.js 16 + TS strict 환경에서 **타입 오류는 `yarn lint`로 안 걸리는 경우가 많다** (특히 prop/generic 변경).
- PR 후 CI에서 첫 발견 → 왕복 손해.

**리스크 수준**: 중 (실제 운영 중 가장 자주 터질 지점)
**개선안**: `hqn-frontend-guardrails` verification baseline을 아래 2줄로 고정.
1. `yarn lint`
2. TS 파일을 건드린 변경이면 `yarn tsc --noEmit`

finish skill의 reviewer 체크리스트에 "TS diff 있으면 tsc 실행 여부 확인" 강제.

---

### 🔴 R5. `hqn_protect_paths.py`가 `MultiEdit` / `NotebookEdit` / Bash 쓰기를 놓침

- 현재 matcher: `"Edit|Write"`.
- `MultiEdit`, `NotebookEdit` 및 Bash로 파일 쓰기(`echo >`, `sed -i`, `tee`, `cat > src/shared/foo.ts`) 는 보호 범위 밖.

**리스크 수준**: 중 (LLM이 Bash로 쓸 확률은 낮지만 0 아님)
**개선안**:
- matcher를 `"Edit|Write|MultiEdit|NotebookEdit"` 로 확장.
- `hqn_guard_shell.py`에 `src/pages/`, `src/shared/` 로 리다이렉트/쓰기 시도 탐지 추가 (`>`, `>>`, `tee`, `sed -i`, `cp|mv ... src/(pages|shared)`).

---

## 2. 운영상 자주 걸릴 중간 리스크 (Medium)

### 🟡 M1. TTL 만료 시 사용자 경험 저하
- start TTL 1시간, finish TTL 2시간. 긴 리뷰/회의 후 돌아오면 만료 → 동일 승인 문답을 다시.
- **개선안**: finish TTL 4~6시간으로 확대, 또는 만료 시 skill이 `show`로 확인 후 자동 재확인만 요청.

### 🟡 M2. 동시 세션 토큰 덮어쓰기
- 상태 파일 1개만 최신 승인 저장 → 두 세션이 다른 work item을 동시에 돌리면 뒤 승인이 앞 승인을 덮음.
- 빈도는 낮지만 `branch_type + work_item` mismatch로 혼란 가능.
- **개선안**: 상태를 리스트화, 또는 파일명 분리 `hqn_start_approval_{workItem}.json`.

### 🟡 M3. planner/reviewer 모두 Opus high-effort → 비용 과다
- 픽업마다 Opus 플래너 1회 + 마무리마다 Opus 리뷰어 1회. 사소한 i18n 수정에도 동일 비용.
- **개선안(토큰 절감 최대)**:
  1. 플래너 기본을 `claude-sonnet-4-6` medium thinking 으로 낮추고, skill에 "복잡도 상 또는 viewer/edit/result 영역 변경 예상 시에만 Opus 승격".
  2. 리뷰어도 동일. "diff 50줄 미만 + forbidden path 미터치" 면 Sonnet으로 충분.
  3. planner agent 명세의 tools 에 Serena가 실제 허용되는지 확인. 문구와 도구 허용 목록을 맞춰야 효과 발생.

### 🟡 M4. `tasks`/`pickup`/`finish` 3개 alias skill 파일 중복
- 각 alias 25~30줄. 역할은 "본 skill 호출"뿐. 디스커버리 텍스트가 초반 프롬프트에 항상 실림.
- **개선안**: alias 파일을 6~8줄 수준으로 압축. description 외 본문 제거, 실제 규칙은 본 skill 에서만 관리.

### 🟡 M5. `hqn_result_spec_local_router.mdc` 및 `neo.mdc` 가 `alwaysApply: true`
- Cursor 사이드. 작업이 HQN이든 아니든 항상 삽입. `neo.mdc` 는 꽤 길고 `frontend_commit_pr_guide.mdc` 등도 함께 항상 로드.
- **개선안**: `alwaysApply: true` 는 짧은 라우터에만 두고, 본문은 `globs` 기반 파일-트리거 로드. 핵심만 남기고 나머지는 skill로 이관.

### 🟡 M6. skill 문서 중복 (guardrails ↔ pickup/finish)
- 브랜치 규칙, 이모지 맵, PR 규칙이 guardrails에도 있고 pickup/finish에도 부분 복사. 매 호출 동일 텍스트가 두 번 올라감.
- **개선안**: guardrails = **유일한 진실의 소스**. pickup/finish는 "이모지 맵/PR 템플릿은 guardrails 참조" 한 줄로 대체. 토큰 체감 절감 큼.

### 🟡 M7. 커맨드 compound 검사 regex의 허점
- `branch_creation_uses_compound_git_chain` 은 문자열 전체에서 `&&` 존재만 본다. 따옴표 안의 `&&` (`--description "... && ..."`) 에도 오판 가능.
- 실사용 빈도는 낮지만 정확도 개선 여지 있음.
- **개선안**: shlex 기반 토큰화 후 토큰 단위로 `&&`/`;` 감지.

---

## 3. 심각도 낮지만 챙기면 좋은 것 (Low)

### 🟢 L1. `settings.local.json` 의 `az:*` 미허용
- skill에 "MCP 안 되면 Azure CLI 사용" 이라고 쓰여 있지만 `Bash(az:*)` 가 allow에 없음. 폴백마다 permission prompt.
- 의도적이면 설명 추가, 편의 원하면 `Bash(az devops:*)`, `Bash(az boards:*)`, `Bash(az repos:*)` 허용.

### 🟢 L2. `PROTECTED_LOCAL_ONLY_PATHS` 의미 확인
- `.gitignore` 도 포함되어 있는데 이건 repo tracked 파일. 커밋 제한 의미가 약함.
- `.git/info/exclude` 에 `frontend/.claude/` 가 걸려 있어 state/settings 은 이미 untracked 처리됨.
- **개선안**: set 이름을 "local-only or sensitive" 로 바꾸고, 진짜 untrack 되어야 할 파일은 `.git/info/exclude` 에도 추가 반영. 현재 훅 보호는 "해당 세션에서만" 유효.

### 🟢 L3. `git fetch` 미명시
- `git pull --ff-only origin product/hqn/main` 이 fetch 를 겸하지만, 이미 최신이면 stale ref 가능성 (아주 드문 엣지케이스).
- **개선안**: 명시적 `git fetch --prune origin` 한 줄 추가.

### 🟢 L4. `head_matches_remote_hqn_main` 의 `cwd` 기준
- `git -C cwd` 라 cwd 가 frontend 면 OK. submodule/worktree 들어가면 오판 가능.
- **개선안**: `git -C REPO_ROOT` 로 고정.

### 🟢 L5. planner 산출물 마크다운 템플릿이 두 곳에 중복
- pickup skill (188~213라인) + planner agent 명세 (38~66라인) 동일 스펙.
- 한 곳만 진실소스로.

### 🟢 L6. commit/push/PR 차단의 false-positive 리스크
- `'git commit' in lowered` 는 `git commit-tree` 등에서도 true. 쓸 일 거의 없지만 혼란 가능.
- **개선안**: 단어 경계 regex `\bgit\s+commit(\s|$)`.

### 🟢 L7. MCP 기반 브랜치 생성 허용
- `mcp__azure-devops__repo_create_branch` 허용 중. skill은 로컬 git 기반 강제. MCP로 만들면 base 검증 우회.
- **개선안**: 실제로 쓸 일이 없으면 **허용 자체 제거** 가 가장 안전.

### 🟢 L8. 한국어/영어 혼재
- skill 본문은 영어, 사용자 응답은 한국어. 작업 승인 문구를 skill에 한국어 고정 예시로 두면 표현 일관성과 사용자 피로 개선.

---

## 4. 토큰/비용 과소비 포인트

세션 시작 시 항상 컨텍스트에 들어가는 주요 덩어리:

1. `neo/CLAUDE.md` (~200줄)
2. `frontend/CLAUDE.md` (~100줄)
3. `frontend/AGENTS.md` 의 skills 매니페스트 (~60줄+)
4. `.cursor/rules/*.mdc` 중 `alwaysApply: true` 다수
5. skill 호출 시 guardrails(120줄) + pickup(237줄) **또는** finish(203줄)
6. planner(Opus, high) / reviewer(Opus, high) 각 1회

체감: **매 픽업-마무리 사이클 1회에 Opus 호출 2회 + 문서 중복 로드 ≈ 토큰 비용의 70%가 "가드레일 반복 로드"에 소비.**

권장 절감 우선순위:
- **M6 (문서 중복 제거)** → pickup/finish 80~100줄 수준으로 축소.
- **M3 (Opus→Sonnet 기본, 승격 룰)** → 호출당 3~5배 비용 감소.
- **M5 (항상 적용 mdc 축소)** → 전 세션 베이스라인 감소.
- **M4 (alias 슬림화)** → 10~30줄 감소.
- skill 내부 bash 예시 블록 반복 최소화.

---

## 5. 구조적으로 "이건 됐다" 싶은 부분

- **이중 게이트 (사용자 승인 + 파일 토큰 + 훅)**: LLM rogue 실행에도 꽤 견고.
- **base branch 검증을 별도 git 명령으로 강제**: `product/hqn/main` mis-base 방지의 핵심.
- **PROTECTED path 스테이징 차단**: 실수 방지에 유효.
- **자연어 라우터는 얇게 + skill 이 실제 규칙 보유**: 책임 분리 OK.
- **planner → implementer → reviewer 체인**: 품질에 유효 (비용만 조율).

---

## 6. 적용 우선순위 (권장 순서)

| 순서 | 항목 | 예상 효과 | 예상 작업 시간 |
|----|----|----|----|
| 1 | **R1** 훅 MCP 매처 추가 | 가장 큰 실사용 리스크 제거 | 1~2h |
| 2 | **R3** 파괴적 패턴 보강 (`branch -D`, 원격 삭제, `rm -rf`) | 사고 방지 | 10m |
| 3 | **R4** verification 에 `yarn tsc --noEmit` 포함 | CI 왕복 감소 | 5m |
| 4 | **M3** planner/reviewer 기본 Sonnet + Opus 승격 조건 | 토큰 비용 3~5배 절감 | 15m |
| 5 | **M6** pickup/finish skill 슬림화 (guardrails 참조형) | 매 호출 토큰 감소 | 30m |
| 6 | **R2** 브랜치 생성 regex 확장 + `repo_create_branch` 허용 제거 검토 | 우회 차단 | 20m |
| 7 | **R5** matcher `MultiEdit` 포함, Bash 쓰기 리다이렉트 감시 | 경로 보호 강화 | 20m |
| 8 | **L3, L7, M5, M4** 정리 | 완성도 | 30m |

---

## 7. 참고: 체크한 파일 목록

- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/settings.local.json`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/skills/hqn-frontend-guardrails/SKILL.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/skills/hqn-ado-pickup-task/SKILL.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/skills/hqn-ado-finish-task/SKILL.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/skills/pickup/SKILL.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/skills/finish/SKILL.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/skills/tasks/SKILL.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/hooks/scripts/hqn_guard_shell.py`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/hooks/scripts/hqn_protect_paths.py`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/hooks/scripts/hqn_start_approval.py`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/hooks/scripts/hqn_finish_approval.py`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/hooks/scripts/hqn_after_edit_context.py`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/agents/planner-opus-4_6.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/agents/implementer-sonnet.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/agents/reviewer-opus-4_6.md`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/state/hqn_start_approval.json`
- `/Users/cheesu/IdeaProjects/neo/frontend/.claude/state/hqn_finish_approval.json`
- `/Users/cheesu/IdeaProjects/neo/frontend/.cursor/rules/hqn_ado_local_router.mdc`
