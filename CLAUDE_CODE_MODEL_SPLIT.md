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
tools: Read, Glob, Grep, Bash, WebFetch, WebSearch   ← 사용 가능 도구
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
tools: Read, Glob, Grep, Edit, Write, Bash   ← 편집 도구 포함
skills:
  - hqn-frontend-guardrails
---
```

**reviewer-opus-4_6.md**:
```markdown
---
name: reviewer-opus-4_6
model: claude-opus-4-6
effort: high
tools: Read, Glob, Grep, Bash   ← 읽기 전용 도구만
skills:
  - hqn-frontend-guardrails
---
```

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

| 컨텍스트 | 적용 규칙 | 실제 모델 |
|---------|---------|---------|
| 메인 대화 (사용자 ↔ Claude) | remote-settings.json `model: "sonnet"` | Sonnet 4.6 |
| planner 에이전트 | agents/planner-opus-4_6.md `model: claude-opus-4-6` | Opus 4.6 |
| implementer 에이전트 | agents/implementer-sonnet.md `model: claude-sonnet-4-6` | Sonnet 4.6 |
| reviewer 에이전트 | agents/reviewer-opus-4_6.md `model: claude-opus-4-6` | Opus 4.6 |

---

## 3. 에이전트별 도구 제한 설계 의도

모델을 나눈 것만큼이나 **도구 접근 범위를 다르게 제한**한 것이 실용적으로 중요하다.

| 에이전트 | 허용 도구 | 핵심 제한 |
|---------|---------|---------|
| planner-opus | Read, Glob, Grep, Bash(읽기), WebFetch, WebSearch | Edit, Write 없음 → 파일 수정 불가 |
| implementer-sonnet | Read, Glob, Grep, Edit, Write, Bash | WebFetch, WebSearch 없음 → 외부 참조 불가 |
| reviewer-opus | Read, Glob, Grep, Bash(읽기) | Edit, Write 없음 → 수정 불가 |

planner가 실수로 파일을 수정하거나, reviewer가 코드를 바꾸는 사고를 도구 레벨에서 원천 차단한다. 모델의 판단을 믿는 것이 아니라 도구 접근 자체를 막는 방식이다.

---

## 4. 설정에 필요한 것

### 4.1 에이전트 파일 만들기

`.claude/agents/` 디렉토리에 마크다운 파일 생성. frontmatter에 최소 `name`과 `model` 필드 필요.

```markdown
---
name: my-agent-name
model: claude-opus-4-6        # 또는 claude-sonnet-4-6, claude-haiku-4-5-20251001
tools: Read, Glob, Grep       # 생략하면 기본 도구 세트 전체
---

# 에이전트 역할 설명 및 시스템 프롬프트
```

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

메인 오케스트레이터(사용자와 직접 대화하는 Claude)는 `remote-settings.json`에 의해 **Sonnet**으로 고정되어 있다.

### 5.2 Sonnet 메인 오케스트레이터의 실제 제약

메인 오케스트레이터가 하는 일을 보면 실제로 Sonnet이면 충분한 작업들이다:

- 사용자 자연어 라우팅 ("일해라" → pickup 흐름 감지)
- 에이전트 스폰 결정 및 지시
- 에이전트 결과물 사용자에게 전달
- 확인 게이트 처리 (예/아니오 판단)
- 간단한 git 명령 실행 및 결과 해석

이런 작업들은 복잡한 추론보다는 패턴 인식과 흐름 제어에 가깝다.

**실제로 문제가 생길 수 있는 시나리오**:
- 플래너가 넘긴 핸드오프 결과를 메인이 해석해서 implementer에게 전달할 때, Sonnet이 핸드오프 내용을 잘못 요약하거나 중요 제약사항을 누락할 수 있다
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

## 8. 참고: 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `.claude/agents/planner-opus-4_6.md` | Opus 4.6 플래너 에이전트 정의 |
| `.claude/agents/implementer-sonnet.md` | Sonnet 4.6 구현 에이전트 정의 |
| `.claude/agents/reviewer-opus-4_6.md` | Opus 4.6 리뷰어 에이전트 정의 |
| `.claude/settings.local.json` | 프로젝트 로컬 권한 설정 |
| `~/.claude/remote-settings.json` | 회사 원격 정책 (`model: "sonnet"`) |
| `CLAUDE.md` / `frontend/CLAUDE.md` | 에이전트 스폰 트리거 조건 정의 |
