# Composer 2 기준 HQN Claude Code · Azure DevOps 워크플로우 감사

> 본 문서는 Cursor **Composer 2** 관점에서 `pickup` / `finish` / `tasks` 스킬 체인, `hqn_guard_shell.py` 등 훅, 승인 스크립트를 코드 기준으로 검토한 정리이다.  
> 작성일 기준 저장소: `neo/frontend` 하위 `.claude/` 구성.

---

## 1. 구조 요약

| 층 | 역할 |
|----|------|
| Cursor 라우터 (`hqn_ado_local_router.mdc`) | "일해라/픽업/마무리" 등 → 해당 `.claude/skills/*.md`로 유도 |
| 짧은 스킬 (`pickup` / `finish` / `tasks`) | 별칭: `hqn-frontend-guardrails` 후 본 스킬 |
| 본 스킬 (`hqn-ado-pickup-task`, `hqn-ado-finish-task`) | ADO 조회, 승인 질문, git 순서, planner/reviewer 서브에이전트 |
| 가드레일 (`hqn-frontend-guardrails`) | 브랜치 형식, 검증, Serena 우선 등 |
| 훅 (`hqn_guard_shell.py`) | Bash에 대해 브랜치 생성·WI 상태·커밋/푸시/PR 검증 |
| 승인 토큰 (`hqn_start_approval.py`, `hqn_finish_approval.py`) | JSON 상태 파일로 게이트 통과 |

**요약**: 규칙은 스킬에, **일부 강제**는 셸 훅에 두는 이중 구조.

---

## 2. 잘 된 점

1. **이중 승인**  
   시작: 작업 항목 선택 후에도 In Progress·브랜치 생성 전 재확인.  
   마무리: 리뷰·lint·사용자 완료 확인 후 `hqn_finish_approval.py` 없이 커밋/푸시/PR 차단.

2. **브랜치 생성 규칙**  
   `product/hqn/main`과 `origin/product/hqn/main` 정합성, 복합 `&&` 체인으로 브랜치 만들기 금지, clean working tree 요구 등이 스킬과 훅에서 일치.

3. **파괴적 git 차단**  
   `reset --hard`, `checkout --`, `clean`, `push --force` 등 거부.

4. **편집 범위** (`hqn_protect_paths.py`)  
   `src/pages`, `src/shared` 직접 편집 차단.

5. **ADO 프로젝트**  
   MWA 고정, NEO로 추론 금지가 반복 명시되어 혼선 완화.

---

## 3. 리스크 (심각도 · 무시 가능 여부)

### 높음 ~ 중간: `cwd`에 따른 훅 전체 스킵

`hqn_guard_shell.py`에서 `cwd`가 `FRONTEND_ROOT`의 부모 체인에 없고 `cwd != FRONTEND_ROOT`이면 `return 0`으로 **검증을 하지 않음**.

- 리포 루트(`.../neo`)에서 Bash를 쓰면 `frontend`는 자식이라 위 조건을 만족해 **전부 스킵**될 수 있음.
- **의미**: 시작/완료 승인·브랜치 규칙이 셸 훅만 믿을 때 **우회 가능**.
- **무시 가능?** 항상 `frontend`에서만 셸을 쓰면 빈도는 낮을 수 있으나, **설계 구멍**이므로 공유/자동화 환경에서는 무시 불가.

**개선**: `REPO_ROOT` 이하 어디서든 동일 검증, 또는 `cwd == REPO_ROOT`일 때도 validator 실행.

---

### 중간: 스킬(MCP 우선) vs 훅(`az` 문자열)

- 작업 항목 상태 변경은 훅이 **`az boards work-item update`** 만 검사.
- 스킬은 ADO **MCP 우선**이므로, MCP만으로 상태를 바꾸면 해당 훅 게이트는 **실행되지 않음**.
- **무시 가능?** "상태 변경은 항상 `az`로만"이면 정렬됨. 그렇지 않으면 스킬에 MCP 사용 시 동일 승인 절차를 명문화하거나, MCP 경로도 막을 수 있는지 검토.

---

### 중간: `az repos pr create` 검증이 부분 문자열 의존

`--target-branch product/hqn/main` 정확 일치, `--draft` 존재 등 **문자열 기준**이라 `--target-branch=` 형태 등에서 거짓 양성 가능.

**개선**: 인자 파싱(`shlex` 등)으로 타깃 브랜치·draft 플래그 정규화 비교.

---

### 중간 이하: 시작 승인 TTL(기본 3600초)

장시간 중단 후 같은 흐름을 이어가면 만료로 브랜치 생성이 막힐 수 있음. 재승인으로 복구 가능.

---

### 낮음: 경로 하드코딩 (`/Users/cheesu/IdeaProjects/neo/...`)

다른 머신·클론 경로에서는 스크립트/스킬 재사용이 어려움. `git rev-parse --show-toplevel` 또는 환경변수 단일화 권장.

---

### 낮음: 마무리 시 work item vs 커밋 `#번호`

훅은 브랜치 패턴 위주라, 브랜치 번호와 커밋 메시지 work item 불일치는 자동 검출 어려움. 선택적으로 브랜치 숫자와 `--work-item` 일치 검사 가능.

---

## 4. 토큰·비용

1. **스킬 중복**  
   `pickup` → guardrails + `hqn-ado-pickup-task` → 또 guardrails. 동일 규칙이 두 번 로드될 수 있음.

2. **`hqn-ado-finish-task` 긴 `az repos pr create` 블록**  
   PR 템플릿이 스킬 본문에 길게 박혀 있어 로드 비용 큼 → `PR_MESSAGE.md` 참조만 남기고 파일 Read로 대체 가능.

3. **매 픽업 `planner-opus-4_6`, 매 마무리 `reviewer-opus-4_6`**  
   품질 대비 비용 최대 구간. 단순 작업에 분기 기준(예: 추정 변경 파일 수·문구만 수정)으로 경량화 옵션을 스킬에 두면 유리.

4. **`hqn_after_edit_context.py`**  
   반복 `additionalContext`는 유용하나 문구가 길면 맥락만 증가. 필요 시 축약.

5. **가드레일의 Serena 안내**  
   Serena 미사용 환경에서는 데드 가이드가 컨텍스트만 차지. 도구 세트에 맞게 한 줄로 정리 가능.

---

## 5. 개선 우선순위 (제안)

1. `hqn_guard_shell.py` **cwd 가드** 수정 — 리포 루트에서도 검증 적용.  
2. **MCP vs `az`** 정책을 스킬에 명문화.  
3. **`validate_pr_create`** 인자 파싱 완화.  
4. 스킬 **본문 슬림화** + 플래너/리뷰어 **조건부** 규칙.  
5. **경로 이식성** (장기).

---

## 6. 총평 (Composer 2 정리)

- 의도(승인 게이트·브랜치 규칙·완료 전 커밋 차단)는 분명하고 실무에 도움이 된다.  
- **훅을 최종 방어선으로 가정하면** `cwd`가 리포 루트일 때 스킵, MCP 경로의 WI 상태 게이트 공백을 반드시 인지해야 한다.  
- 토큰은 **스킬 중복·긴 스니펫·고비용 서브에이전트 매번 호출**이 가장 크다. 품질과 비용의 분기 기준을 스킬에 숫자로 박아 두는 것을 권장한다.

---

## 참고 파일

- `frontend/.claude/skills/hqn-frontend-guardrails/SKILL.md`
- `frontend/.claude/skills/hqn-ado-pickup-task/SKILL.md`
- `frontend/.claude/skills/hqn-ado-finish-task/SKILL.md`
- `frontend/.claude/skills/pickup/SKILL.md`, `finish/SKILL.md`, `tasks/SKILL.md`
- `frontend/.claude/hooks/scripts/hqn_guard_shell.py`
- `frontend/.claude/hooks/scripts/hqn_start_approval.py`, `hqn_finish_approval.py`
- `frontend/.cursor/rules/hqn_ado_local_router.mdc`
