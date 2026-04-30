# Claude Code 모델 분리 전략 상세 분석

> 작성일: 2026-04-23
> 대상: `.claude/agents/` 기반의 에이전트 모델 분리 구조

---

## 핵심 요약

**어떻게 모델을 나누는가**
- `.claude/agents/{name}.md` 파일의 frontmatter에 `model: claude-opus-4-6` 또는 `model: claude-sonnet-4-6`을 명시
- 메인 Claude가 `Agent` 도구로 에이전트를 스폰하면 그 파일에 정의된 모델로 독립 실행됨
- 도구도 에이전트별로 다르게 제한 (planner/reviewer는 Edit/Write 없음, implementer는 WebFetch 없음)

**메인 오케스트레이터 Sonnet vs Opus**
- 메인이 하는 일은 라우팅, 에이전트 스폰 결정, 결과 전달이라 Sonnet으로 충분한 경우가 많음
- 에이전트 결과 해석, 충돌 판단, 에러 복구 같은 상황에서는 Opus가 더 안정적
- 하지만 메인을 Opus로 올려도 이미 planner/reviewer가 Opus이므로 추가 이득이 제한적

**가성비**
- 파일 읽기/코드 작성이 많은 중간 이상 복잡도 태스크에서 효과가 나옴
- 단순 작업에는 full 플로우 오버헤드가 오히려 클 수 있음
- Serena MCP가 planner의 파일 탐색 토큰을 억제해주는 게 비용에 실질 기여

---

## 0. 먼저 읽어야 할 개념 정리

> 처음 이 문서를 보면 "서브에이전트냐, 팀 에이전트냐, 오케스트레이터는 뭘 쓰냐"가 헷갈릴 수 있다.
> 섹션 1~8을 읽기 전에 이 개념 지도를 먼저 잡아두면 이해가 훨씬 쉽다.

### 0.1 지금 이 대화 상대(메인 Claude)가 오케스트레이터다

Claude Code를 열어서 "일해라"라고 입력하면 사용자와 직접 대화하는 Claude 인스턴스가 하나 뜬다. 이게 **메인 Claude**, 즉 **오케스트레이터**다.

오케스트레이터가 하는 일:
- 사용자 입력을 해석 (CLAUDE.md / skill 지시문 참고)
- 어떤 서브에이전트를 언제 스폰할지 결정
- `Agent` 도구를 직접 호출해서 서브에이전트를 띄움
- 서브에이전트 결과를 받아서 다음 단계로 전달
- 사용자 확인 게이트 처리

```
사용자: "일해라" (pickup)
    ↓
[메인 Claude (Sonnet)] ← 오케스트레이터. 지금 대화 중인 이 Claude
    │
    │ CLAUDE.md 읽음 → pickup 흐름 감지
    │
    ├─→ [planner-opus-4_6]  (Opus, 서브에이전트로 스폰)
    │         ↓ 핸드오프 텍스트 반환
    │         ↓ [오케스트레이터] .claude/state/handoff.md 에 저장
    │
    │ 사용자 확인: "구현을 시작할까요?"
    │
    ├─→ [implementer-sonnet]  (Sonnet, 서브에이전트로 스폰)
    │         ↓ handoff.md 읽고 구현 → 압축 결과 반환
    │
    │ 사용자 확인: "바로 리뷰와 커밋을 진행할까요?"
    │
    ├─→ [reviewer-opus-4_6]  (Opus, 서브에이전트로 스폰)
    │         ↓ git diff 기반 리뷰 → verdict + findings 반환
    │         ↓ not ready 시 → [오케스트레이터] review_findings.md 에 저장
    │
    │ (not ready 시) → implementer-sonnet 재스폰 → 재리뷰 (1회)
    │
    │ 사용자 최종 승인 → 커밋 / 푸시 / PR 생성
    │
    → 사용자에게 최종 결과 전달
```

### 0.2 CLAUDE.md와 skill은 오케스트레이터가 아니다

CLAUDE.md와 skill 파일은 **오케스트레이터(메인 Claude)가 읽는 지시 문서**다. 이 파일들이 에이전트를 직접 띄우는 게 아니라, 메인 Claude가 이 문서를 읽고 "지금 planner를 스폰해야겠다"고 판단해서 `Agent` 도구를 호출하는 것이다.

```
CLAUDE.md / skill = "언제 어떤 에이전트를 호출해" 라고 적힌 규칙서
메인 Claude       = 그 규칙서를 읽고 실제로 Agent 도구를 호출하는 실행 주체
```

에이전트 간 데이터 전달은 `.claude/state/` 파일을 통해 이루어진다:
- `handoff.md`: **planner가 텍스트 반환 → 오케스트레이터가 저장**, implementer가 읽음
- `review_findings.md`: **reviewer가 텍스트 반환 → 오케스트레이터가 저장** (not ready 시), implementer가 읽음 (수정 시)

planner와 reviewer는 `disallowedTools: Write, Edit`으로 파일을 직접 쓸 수 없다. 파일 저장은 메인 오케스트레이터의 책임이다. 이 방식으로 메인 오케스트레이터가 핸드오프 전문을 컨텍스트에 중복 보관하지 않아 토큰 효율이 높다.

### 0.3 서브에이전트 = 메인이 Agent 도구로 띄운 독립 프로세스

`Agent` 도구를 호출하면 **완전히 별도의 컨텍스트 윈도우**를 가진 새 Claude 프로세스가 생긴다. 이게 서브에이전트다.

핵심 특성:
- 메인과 대화 기록을 공유하지 않음 (컨텍스트 격리)
- 메인이 넘겨준 `prompt`만 보고 동작
- 작업 완료 후 결과를 메인에게 반환하고 종료

### 0.4 "팀 에이전트"나 "에이전트팀"은 별도 기술이 아니다

"팀 에이전트", "에이전트팀", "멀티에이전트"는 모두 같은 구조를 부르는 다양한 표현이다. **메인 오케스트레이터가 여러 서브에이전트를 순차 또는 병렬로 운용하는 패턴**이고, Claude Code에서는 `Agent` 도구 하나로 구현된다. 별도 SDK나 인프라가 필요하지 않다.

### 0.5 모델 스플릿은 그 위에 얹은 최적화 레이어다

서브에이전트 패턴 자체는 모델을 나누지 않아도 된다. 이 프로젝트는 거기에 추가로 **역할별로 다른 모델을 지정**하는 전략을 쓴다.

```
[일반 서브에이전트 패턴]        [이 프로젝트: 실제 흐름]

메인 (기본값)                  메인 (오케스트레이터) ← 라우팅 + 확인 게이트 + 파일 저장 담당
  ├─ 서브A (기본값)              ├─ planner      → Opus 서브에이전트 → 핸드오프 반환
  ├─ 서브B (기본값)              │                  └─ 오케스트레이터가 handoff.md 저장
  └─ 서브C (기본값)              ├─ implementer  → Sonnet 서브에이전트 → handoff.md 읽고 구현
                                 ├─ reviewer     → Opus 서브에이전트 → findings 반환
                                 │                  └─ 오케스트레이터가 review_findings.md 저장
                                 └─ implementer  → (not ready 시) review_findings.md 읽고 수정
```

정리하면:
- **서브에이전트** = 메커니즘 (독립 프로세스 격리). 이 프로젝트에서는 planner, implementer, reviewer 3개 모두 실제 스폰
- **모델 스플릿** = 그 메커니즘 위의 최적화 전략 (비용 vs 품질)
- **오케스트레이터** = 메인 Claude. 사용자와 대화하는 바로 그 인스턴스이며, 라우팅과 확인 게이트만 담당
- **파일 릴레이** = `.claude/state/` 파일로 에이전트 간 데이터 전달. 메인 컨텍스트 중복 적재 방지

---

## 1. 어떻게 모델을 나눠서 요청하는가

### 1.1 핵심 메커니즘: 에이전트 정의 파일

Claude Code는 `.claude/agents/` 디렉토리에 마크다운 파일을 두면 그 파일에 정의된 모델로 동작하는 서브에이전트를 스폰할 수 있다. 이 파일의 frontmatter에 `model` 필드가 있고, 메인 오케스트레이터가 `Agent` 도구를 호출할 때 해당 에이전트를 지명하면 서로 다른 모델로 분기된다.

```
Agent 도구 호출
  subagent_type: "planner-opus-4_6"
       │
       ▼
  .claude/agents/planner-opus-4_6.md 읽음
       │
       ▼
  model: claude-opus-4-6  ← 이 모델로 독립 프로세스 실행
```

### 1.2 실제 에이전트 파일 위치

```
/Users/cheesu/IdeaProjects/neo/frontend/
└── .claude/
    └── agents/
        ├── planner-opus-4_6.md      ← Opus 4.6 사용
        ├── implementer-sonnet.md    ← Sonnet 4.6 사용
        └── reviewer-opus-4_6.md    ← Opus 4.6 사용
```

에이전트 파일은 프로젝트 레포에 체크인되어 있다 (`.claude/agents/`). 글로벌 에이전트는 `~/.claude/agents/`에 놓으면 된다.

### 1.3 에이전트 정의 파일 구조 (실제)

**planner-opus-4_6.md**:
```markdown
---
name: planner-opus-4_6
description: Plans HQN frontend Azure DevOps work...
model: claude-opus-4-6          ← 모델 고정
effort: high                    ← 추론 깊이 힌트 (높음)
disallowedTools: Write, Edit, MultiEdit, NotebookEdit,
  mcp__azure-devops__wit_update_work_item,
  mcp__azure-devops__repo_create_branch,
  mcp__azure-devops__repo_create_pull_request,
  mcp__azure-devops__repo_create_pull_request_thread,
  mcp__azure-devops__wit_create_work_item
skills:
  - hqn-frontend-guardrails     ← 로드할 스킬
---

# 에이전트 시스템 프롬프트 본문 ...
```

**implementer-sonnet.md**:
```markdown
---
name: implementer-sonnet
model: claude-sonnet-4-6        ← 모델 고정
disallowedTools: NotebookEdit,
  mcp__azure-devops__wit_update_work_item,
  mcp__azure-devops__repo_create_branch,
  mcp__azure-devops__repo_create_pull_request,
  mcp__azure-devops__repo_create_pull_request_thread,
  mcp__azure-devops__wit_create_work_item
skills:
  - hqn-frontend-guardrails
---
```
(implementer는 Edit/Write를 사용해야 하므로 allowlist 대신 ADO MCP 쓰기 도구만 차단)

**reviewer-opus-4_6.md**:
```markdown
---
name: reviewer-opus-4_6
model: claude-opus-4-6
effort: high
disallowedTools: Write, Edit, MultiEdit, NotebookEdit,
  mcp__azure-devops__wit_update_work_item,
  mcp__azure-devops__repo_create_branch,
  mcp__azure-devops__repo_create_pull_request,
  mcp__azure-devops__repo_create_pull_request_thread,
  mcp__azure-devops__wit_create_work_item
skills:
  - hqn-frontend-guardrails
---
```

**설계 기준**: `tools:` allowlist 대신 `disallowedTools:` blocklist를 사용한다. 새 도구가 추가될 때 허용 목록을 매번 업데이트하지 않아도 되고, "이것만 못 쓴다"가 "이것만 쓸 수 있다"보다 에이전트 역할 의도를 더 명확하게 표현한다.

---

## 2. 모델 결정 우선순위

Claude Code에서 어떤 모델이 사용될지는 다음 순서로 결정된다. 위에 있을수록 우선순위가 높다.

```
1. Agent 도구 호출 시 model 파라미터 (직접 지정)
      Agent(subagent_type="...", model="opus")
      ↓ 없으면
2. .claude/agents/{name}.md 의 frontmatter model 필드
      model: claude-opus-4-6
      ↓ 없으면
3. 프로젝트 settings.json 또는 settings.local.json 의 model 필드
      ↓ 없으면
4. ~/.claude/remote-settings.json 의 model 필드
      model: "sonnet"  ← 회사 원격 정책에서 기본값으로 설정됨
      ↓ 없으면
5. Claude Code 기본값 (현재 Sonnet 계열)
```

이 프로젝트에서의 실제 흐름:

| 컨텍스트 | 적용 규칙 | 실제 모델 | 스폰 시점 |
|---------|---------|---------|---------|
| 메인 대화 (사용자 ↔ Claude) | remote-settings.json `model` 필드 (기본값 보통 sonnet, 세션 오버라이드 가능) | 세션 설정에 따름 | - (메인 세션) |
| planner 에이전트 | agents/planner-opus-4_6.md `model: claude-opus-4-6` | Opus 4.6 | pickup에서 스폰 |
| implementer 에이전트 | agents/implementer-sonnet.md `model: claude-sonnet-4-6` | Sonnet 4.6 | pickup에서 스폰 + finish에서 수정 시 재스폰 |
| reviewer 에이전트 | agents/reviewer-opus-4_6.md `model: claude-opus-4-6` | Opus 4.6 | finish에서 스폰 |

---

## 3. 에이전트별 도구 제한 설계 의도

모델을 나눈 것만큼이나 **도구 접근 범위를 다르게 제한**한 것이 실용적으로 중요하다.

| 에이전트 | 차단된 도구 | 핵심 효과 |
|---------|---------|---------|
| planner-opus | Write, Edit, MultiEdit + ADO MCP 5종 | 파일 수정 불가, ADO 직접 조작 불가 |
| implementer-sonnet | ADO MCP 5종 | Edit/Write는 허용(구현 필요), ADO 직접 조작만 차단 |
| reviewer-opus | Write, Edit, MultiEdit + ADO MCP 5종 | 파일 수정 불가, ADO 직접 조작 불가 |

ADO MCP 5종: `wit_update_work_item`, `repo_create_branch`, `repo_create_pull_request`, `repo_create_pull_request_thread`, `wit_create_work_item`

planner가 실수로 파일을 수정하거나, reviewer가 코드를 바꾸는 사고를 도구 레벨에서 원천 차단한다. 모든 에이전트에서 ADO 쓰기 MCP를 차단해 MCP ADO 조작은 메인 오케스트레이터만 가능하며, 오케스트레이터도 `hqn_guard_mcp_ado.py` 훅의 토큰 검증을 통과해야 한다.

---

## 4. 설정에 필요한 것

### 4.1 에이전트 파일 만들기

`.claude/agents/` 디렉토리에 마크다운 파일 생성. frontmatter에 최소 `name`과 `model` 필드 필요.

```markdown
---
name: my-agent-name
model: claude-opus-4-6        # 또는 claude-sonnet-4-6, claude-haiku-4-5-20251001
disallowedTools: Write, Edit  # 차단할 도구 목록 (allowlist보다 blocklist 방식 권장)
---

# 에이전트 역할 설명 및 시스템 프롬프트
```

`tools:` allowlist도 지원되지만 이 프로젝트는 `disallowedTools:` blocklist를 채택한다. 새 도구가 추가될 때 허용 목록을 매번 업데이트하지 않아도 되기 때문이다.

현재 사용 가능한 model 값 (2026-04 기준):
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5-20251001`

또는 단축명 (`opus`, `sonnet`, `haiku`) 으로도 지정 가능하다 (Agent 도구의 `model` 파라미터에서).

### 4.2 메인 오케스트레이터 기본 모델 설정

```json
// ~/.claude/remote-settings.json (회사 원격 정책) 또는
// .claude/settings.json (프로젝트) 또는
// .claude/settings.local.json (개인)
{
  "model": "sonnet"
}
```

### 4.3 스킬 파일 배치

에이전트가 `skills:` 필드에 지정한 스킬은 프로젝트의 `.claude/skills/{name}/SKILL.md` 또는 글로벌 `~/.claude/skills/{name}/SKILL.md`에 있어야 한다.

```
.claude/
├── agents/
│   ├── planner-opus-4_6.md
│   ├── implementer-sonnet.md
│   └── reviewer-opus-4_6.md
└── skills/
    └── hqn-frontend-guardrails/
        └── SKILL.md
```

### 4.4 에이전트를 실제로 호출하는 방법

메인 Claude가 Agent 도구를 통해 에이전트를 스폰한다. CLAUDE.md나 skill에서 지시문으로 정해두거나, 메인 Claude가 판단해서 직접 호출한다.

```
# skill이나 CLAUDE.md에서 "planner-opus-4_6을 spawn하라"고 지시하거나
# 메인 Claude가 상황에 맞게 직접 호출

Agent(
  subagent_type="planner-opus-4_6",
  prompt="work item #68900을 분석하고 구현 계획을 수립해줘",
  description="ADO 태스크 분석 및 계획"
)
```

---

## 5. 메인 오케스트레이터가 Sonnet일 때 vs Opus일 때

### 5.1 현재 이 프로젝트의 구성

메인 오케스트레이터(사용자와 직접 대화하는 Claude)의 기본 모델은 `remote-settings.json`의 `model` 필드로 결정된다. 회사 기본값이 Sonnet으로 설정되어 있어도, 세션 시작 시 `--model opus` 옵션으로 오버라이드할 수 있다. **서브에이전트(planner, implementer, reviewer)의 모델은 `agents/*.md` frontmatter에 고정**되어 메인 모델과 무관하게 항상 동일하다.

### 5.2 Sonnet 메인 오케스트레이터의 실제 제약

메인 오케스트레이터가 하는 일을 보면 실제로 Sonnet이면 충분한 작업들이다:

- 사용자 자연어 라우팅 ("일해라" → pickup 흐름 감지)
- 에이전트 스폰 결정 및 지시
- 에이전트 결과물 사용자에게 전달 (압축된 결과만 전달받으므로 해석 부담 최소)
- 확인 게이트 처리 (예/아니오 판단)
- 간단한 git 명령 실행 및 결과 해석

이런 작업들은 복잡한 추론보다는 패턴 인식과 흐름 제어에 가깝다. 파일 기반 릴레이로 핸드오프를 직접 해석하거나 요약할 필요가 없어져 Sonnet 메인의 부담이 더 줄었다.

**실제로 문제가 생길 수 있는 시나리오**:
- 에이전트 결과가 엇갈리거나 충돌할 때 Sonnet이 판단을 내려야 하는 경우, 섬세한 판단이 필요하면 놓칠 수 있다
- 비정상적인 에러 상황에서 복구 전략을 스스로 수립해야 할 때 추론 깊이가 부족할 수 있다

### 5.3 Opus 메인 오케스트레이터로 바꾸면?

`model: "opus"` 로 바꾸거나, 세션 시작 시 `/fast` 또는 `--model opus`를 쓰면 된다.

**달라지는 것**:
- 자연어 라우팅 정확도가 미묘하게 높아질 수 있다
- 에이전트 결과물을 해석하는 품질이 높아질 수 있다
- 에러 상황에서 더 나은 판단을 내릴 수 있다

**달라지지 않는 것**:
- planner, reviewer는 어차피 Opus로 실행된다 (에이전트 파일에서 고정)
- implementer는 어차피 Sonnet으로 실행된다

**비용 영향**:
메인 오케스트레이터가 Opus가 되면, 사용자와의 대화 및 에이전트 간 조율 토큰이 모두 Opus 요금으로 처리된다. 이 부분은 보통 전체 토큰의 20~30% 정도를 차지하는데, 이를 Opus로 올리는 것은 비용 대비 효과가 크지 않을 가능성이 높다.

---

## 6. 가성비 분석 (과장 없이)

### 6.1 이 전략이 의미있는 이유

모델 분리 전략의 실제 비용 절감 효과는 **토큰 볼륨의 비대칭**에서 온다.

```
planner (Opus, 1회 실행):
  - 입력: ADO work item 텍스트 + 코드베이스 심볼 탐색 결과
  - 출력: 구조화된 핸드오프 문서 (수백~수천 토큰)
  - 실행 횟수: 태스크당 1회

implementer (Sonnet, 여러 번 실행):
  - 입력: 핸드오프 + 파일 읽기 결과 (파일마다 수천 토큰)
  - 출력: 코드 변경 (diff 기준 수백~수천 토큰)
  - 실행 횟수: 구현 과정에서 반복 가능

reviewer (Opus, 1회 실행):
  - 입력: 변경된 파일들 + 핸드오프
  - 출력: 리뷰 결과 (수백 토큰)
  - 실행 횟수: 태스크당 1회
```

파일 읽기와 코드 작성이 반복되는 고볼륨 작업이 Sonnet으로 가고, 판단이 필요한 저볼륨 작업이 Opus로 가는 구조다. 구현 단계에서 큰 파일을 여러 번 읽고 수정하는 토큰이 전체의 다수를 차지한다.

### 6.2 실제로 얼마나 절감되는가

정확한 수치는 태스크 복잡도에 따라 크게 달라지기 때문에 단정하기 어렵다. 다만 대략적인 틀:

- 단순한 태스크 (버그픽스, UI 텍스트 수정): planner/reviewer의 Opus 호출이 비교적 짧고, implementer 토큰도 적어 모델 분리 효과가 작다
- 복잡한 태스크 (새 기능 구현, 여러 파일 수정): implementer가 파일을 많이 읽고 반복 수정하는 토큰이 커져서 Sonnet 할인 효과가 커진다

파일을 많이 읽는 작업일수록 모델 분리 효과가 크다.

### 6.3 비용이 오히려 증가할 수 있는 경우

- **planner가 불필요하게 많은 파일을 읽는 경우**: Opus로 넓게 탐색하면 Sonnet 전체보다 비쌀 수 있다
- **에이전트 핸드오프가 실패해서 재시도가 반복되는 경우**: planner를 여러 번 실행하면 Opus 비용이 중복 발생
- **짧은 단순 작업에 full 플로우를 타는 경우**: planner + implementer + reviewer를 모두 돌리는 오버헤드가 단순 수정 비용보다 클 수 있다

### 6.4 Serena MCP와의 상승 효과

Serena가 없었다면 planner(Opus)가 전체 파일을 읽어야 해서 Opus 토큰이 급격히 증가했을 것이다. Serena의 심볼 단위 탐색 덕분에 planner가 필요한 부분만 읽을 수 있어, Opus 비용을 억제하는 데 실질적으로 기여한다.

#### 실측 비교 (2026-04-24)

**테스트 태스크**: CTA 뷰어의 show/hide 버튼 수정 (탐색 단계까지, 실제 수정 제외)
**탐색 타깃**: `ResultViewer.tsx`의 `handleToggleVisualization` + `isVisualizationOpen`
**탐색 대상 파일**: `CTAMultiViewer.tsx` (1,051줄), `ResultViewer.tsx` (594줄)

| 단계 | Serena 경로 | 표준 경로 (Glob → Grep → Read) |
|------|------------|-------------------------------|
| 파일/심볼 탐색 | `find_symbol` → 심볼 위치 목록 ~4,400자 | `Glob` × 3 → 경로 목록 ~800자 |
| 구조 파악 | `get_symbols_overview` × 2 → ~5,000자 | `Read(CTAMultiViewer.tsx)` → **~52,000자** |
| 타깃 코드 읽기 | `find_symbol(include_body=True)` → ~100자 | `Read(ResultViewer.tsx)` → **~30,000자** |
| **합계** | **~9,500자 ≈ ~2,400 토큰** | **~83,000자 ≈ ~20,750 토큰** |

```
Serena 경로:    ~2,400 토큰
표준 경로:     ~20,750 토큰

차이: 약 8~9배
```

**핵심 이유**: 표준 경로는 타깃이 10~20줄 함수 하나여도 해당 함수를 찾기 위해 파일 전체를 컨텍스트에 올린다. Serena는 심볼 트리에서 정확한 위치를 파악한 뒤 그 함수 본문만 읽기 때문에 파일 크기와 무관하게 로딩량이 낮다.

planner가 Opus로 실행되는 이 구조에서는 탐색 토큰이 Opus 요금으로 과금된다. 파일이 크고 관련 파일 수가 많을수록 Serena의 토큰 억제 효과가 비용에 직접 기여한다.

**2026-04-30 업데이트**: 세션 리뷰 분석(#69731) 결과 planner가 Serena 대신 Grep을 사용하는 패턴이 반복됨이 확인됐다. `planner-opus-4_6.md`에 `## Tool usage rules` 섹션을 추가해 심볼 검색 시 Grep 명시적 금지 하드 규칙을 적용했다. 기존 guardrails의 "Prefer Serena" 권고 수준에서 에이전트 지침의 하드 규칙으로 격상됨.

### 6.5 솔직한 평가

이 전략이 항상 비용을 절감한다고 단언하기 어렵다. 효과는 이런 조건에서 더 확실하다:

- 파일 탐색과 코드 작성이 많은 중간~복잡 태스크
- Serena가 정상적으로 심볼 탐색을 해주는 환경
- planner가 1회 실행으로 깔끔한 핸드오프를 만들어내는 경우

반면, 짧은 단순 작업이거나 에이전트 실패로 재시도가 잦으면 오히려 단순히 Sonnet 하나로 처음부터 끝까지 처리하는 것보다 비쌀 수 있다.

---

## 7. 설정 최소 요구사항 정리

모델 분리 전략을 새 프로젝트에 적용하고 싶다면 필요한 것:

```
필수:
1. .claude/agents/{agent-name}.md 파일 (model 필드 포함)
2. CLAUDE.md 또는 skill에서 해당 에이전트를 언제 스폰할지 지시

선택:
3. ~/.claude/remote-settings.json 또는 .claude/settings.json 에서
   메인 오케스트레이터 기본 모델 설정 (없으면 Claude Code 기본값)
4. .claude/skills/ 에 에이전트가 참조할 스킬 파일
5. tools 필드로 에이전트 도구 접근 제한 (보안/역할 명확화 목적)
```

Claude Code 기능이기 때문에 외부 라이브러리나 별도 인프라는 불필요하다. 마크다운 파일 몇 개가 전부다.

---

## 8. implementer-sonnet 자동 스폰: 현재 구현

implementer-sonnet은 pickup과 finish 양쪽에서 자동으로 스폰된다.

### 8.1 pickup에서의 스폰

planner가 핸드오프를 `.claude/state/handoff.md`에 저장한 뒤, 사용자 확인을 받고 implementer-sonnet을 스폰한다. implementer는 파일에서 핸드오프를 읽으므로, 메인 오케스트레이터가 핸드오프 전문을 컨텍스트에 보관할 필요가 없다.

### 8.2 finish에서의 재스폰 (리뷰 수정 루프)

reviewer가 "not ready" 판정을 내리면, findings를 텍스트로 반환한다. **메인 오케스트레이터**가 이 findings를 `.claude/state/review_findings.md`에 저장한다 (reviewer는 Write/Edit이 disallowedTools라 직접 쓸 수 없다). 사용자가 수정을 확인하면 implementer-sonnet을 재스폰하고, implementer는 `review_findings.md` + `handoff.md` 두 파일을 읽고 수정한다. 수정 후 reviewer를 1회만 재스폰한다. 두 번째 리뷰도 통과 못하면 중단하고 사용자에게 결정을 넘긴다.

### 8.3 자동 스폰의 트레이드오프 (참고)

**장점**:
- 컨텍스트 격리 — 핸드오프만 보고 깨끗한 상태에서 구현
- 도구 제한 강제 — Edit, Write, Bash만 허용, WebFetch 없음
- 메인 컨텍스트가 구현 과정의 파일 읽기/쓰기 토큰으로 오염되지 않음
- 출력 압축 — 압축된 결과 리포트로 메인 컨텍스트 팽창 억제

**단점**:
- 서브에이전트는 대화 맥락을 모름 — 사용자가 구두로 전달한 조건은 핸드오프에 포함되지 않으면 누락
- 구현 중 막히면 서브에이전트 완료 후에야 사용자 소통 가능
- 핸드오프 품질이 낮으면 잘못된 방향으로 완주할 위험

### 8.4 토큰 효율 최적화 요약

| 최적화 | 적용 위치 | 효과 |
|-------|---------|------|
| 파일 기반 핸드오프 릴레이 | 오케스트레이터 → `.claude/state/handoff.md` | 메인 컨텍스트에 핸드오프 2중 적재 방지 |
| 파일 기반 리뷰 결과 릴레이 | 오케스트레이터 → `.claude/state/review_findings.md` | 수정 루프 시 메인 컨텍스트 부담 감소 |
| Diff-first 리뷰 | reviewer | Opus 토큰 절감 (전체 파일 Read 대신 git diff) |
| 에이전트 출력 압축 | implementer, reviewer | 메인 컨텍스트 팽창 억제 |
| Scoped lint | implementer, finish | 변경 파일만 lint → 시간 + 출력 토큰 절감 |
| yarn tsc --noEmit | implementer, finish | lint가 잡지 못하는 타입 에러 조기 검출 |
| 결정론적 preflight | finish (reviewer 스폰 전) | 브랜치 패턴/금지 경로/tsc/lint 실패 시 Opus reviewer 스폰 생략 |
| PostToolUse 세션당 1회 주입 | hqn_after_edit_context.py | 반복 편집 시 컨텍스트 누적 없이 리마인더 효과 유지 |
| Light mode | pickup (단순 태스크) | i18n/CSS 등 단순 변경은 planner+reviewer Opus 호출 없이 완료 |
| Serena 심볼 탐색 | planner | Opus 파일 탐색 토큰 8~9배 절감 |

---

## 10. 참고: 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `.claude/agents/planner-opus-4_6.md` | Opus 4.6 플래너 에이전트 정의 |
| `.claude/agents/implementer-sonnet.md` | Sonnet 4.6 구현 에이전트 정의 |
| `.claude/agents/reviewer-opus-4_6.md` | Opus 4.6 리뷰어 에이전트 정의 |
| `.claude/settings.local.json` | 프로젝트 로컬 권한 설정 |
| `~/.claude/remote-settings.json` | 회사 원격 정책 (`model: "sonnet"`) |
| `CLAUDE.md` / `frontend/CLAUDE.md` | 에이전트 스폰 트리거 조건 정의 |
