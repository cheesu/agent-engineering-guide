# Claude Code HQN Frontend 자동화 워크플로우 상세 가이드

> 작성일: 2026-04-23
> 대상 프로젝트: NEO Frontend (HQN 제품)
> 목적: "일해라" 한 마디로 ADO 태스크 픽업 → 구현 → PR까지 자동화되는 워크플로우의 기술 구성과 장단점 정리

---

## 1. 전체 워크플로우 개요

```
사용자: "일해라"
    │
    ▼
[CLAUDE.md 자연어 라우팅]
    │  "일해라" → pickup 흐름 감지
    ▼
[planner-opus-4_6 에이전트]
    │  Azure DevOps MCP로 할당된 Work Item 목록 조회
    │  사용자에게 선택 요청 (확인 게이트 #1)
    ▼
[ADO 상태 변경 + 브랜치 생성]
    │  Work Item → "In Progress"
    │  product/hqn/main 기반 작업 브랜치 생성
    ▼
[planner-opus-4_6 에이전트]
    │  Serena MCP로 코드베이스 심층 분석
    │  구현 계획(핸드오프) 작성
    │  영향 범위, 수정 대상 파일 식별
    ▼
[implementer-sonnet 에이전트]
    │  계획대로 코드 구현
    │  파일 수정/생성
    │  lint, 빌드 검증
    ▼
사용자: "마무리" / "끝내"
    │
    ▼
[reviewer-opus-4_6 에이전트]
    │  변경사항 전체 리뷰
    │  guardrails 준수 여부 확인
    │  사용자에게 최종 승인 요청 (확인 게이트 #2)
    ▼
[neo-commit-helper 스킬]
    │  NEO 커밋 컨벤션으로 커밋 메시지 생성
    │  커밋 + push
    ▼
[Azure DevOps MCP]
    │  product/hqn/main 대상 Draft PR 생성
    ▼
완료
```

---

## 2. 구성 기술 상세

### 2.1 Claude Code CLI

**역할**: 전체 오케스트레이터. 사용자의 자연어 입력을 받아 각 에이전트와 MCP 서버를 조율한다.

- **실행 위치**: 로컬 터미널 (IDE 확장 또는 CLI)
- **모델 기본값**: `sonnet` (remote-settings.json에서 회사 전체 적용)
- **컨텍스트 지속성**: 대화 세션 동안 작업 맥락 유지, 자동 압축으로 긴 대화도 처리

```json
// ~/.claude/remote-settings.json (회사 원격 정책)
{
  "model": "sonnet",          // 기본 모델 = 저렴한 Sonnet
  "channelsEnabled": true,    // 회사 원격 정책 적용
  "permissions": {
    "deny": ["Read(./.env)", "Read(./secrets/**)"]  // 보안: 민감 파일 읽기 차단
  }
}
```

---

### 2.2 모델 분리 전략 (Opus vs Sonnet)

핵심 설계 원칙: **비싼 모델은 생각에, 싼 모델은 실행에**

| 에이전트 | 사용 모델 | 역할 | 이유 |
|---------|---------|------|------|
| `planner-opus-4_6` | Claude Opus 4.6 | ADO 분석, 코드베이스 탐색, 구현 계획 수립 | 복잡한 추론, 아키텍처 이해, 실수 비용이 큼 |
| `implementer-sonnet` | Claude Sonnet 4.6 | 실제 코드 작성, 파일 수정, 빌드 검증 | 반복적 실행 작업, 토큰 소비 많음 |
| `reviewer-opus-4_6` | Claude Opus 4.6 | PR 전 최종 코드 리뷰 | 품질 검증은 정확도가 중요 |
| 메인 오케스트레이터 | Claude Sonnet 4.6 | 사용자 대화, 라우팅 | 기본 진행, 원격 정책 기본값 |

**실제 비용 효과**: Opus는 Sonnet 대비 약 5배 비싸므로, 단순 코드 생성 토큰 비용을 Sonnet으로 처리해 전체 비용을 크게 절감.

---

### 2.3 CLAUDE.md 기반 자연어 라우팅

**역할**: 코드베이스에 체크인된 "AI 행동 규칙서". 별도 설정 없이 프로젝트 클론만 하면 팀 전체가 동일한 워크플로우를 사용한다.

```
/Users/cheesu/IdeaProjects/neo/CLAUDE.md           ← 전사 공통 규칙
/Users/cheesu/IdeaProjects/neo/frontend/CLAUDE.md  ← HQN 프론트엔드 특화 규칙
```

**프론트엔드 CLAUDE.md 핵심 규칙**:
- "일해라", "픽업", "작업해" → `pickup` 흐름 트리거
- "마무리", "끝내", "PR 만들어" → `finish` 흐름 트리거
- ADO project는 항상 `MWA` (NEO 아님)
- 브랜치는 반드시 `product/hqn/main` 기반에서만 생성
- 사용자 응답은 기본 한국어

---

### 2.4 커스텀 스킬 (Skills)

`~/.claude/skills/` 에 정의된 프로젝트/팀 특화 명령어 모음.

```
~/.claude/skills/
├── hqn-ado-pickup-task      # 태스크 픽업 전체 플로우
├── hqn-ado-finish-task      # 태스크 완료 전체 플로우
└── hqn-frontend-guardrails  # 안전 규칙 (브랜치 보호, 확인 게이트 등)
```

**guardrails 역할** (hqn-frontend-guardrails):
- `product/hqn/main` 직접 push 차단
- 확인 없이 ADO 상태 변경 차단
- 확인 없이 브랜치 생성 차단
- 커밋 전 반드시 사용자 최종 승인 요구

---

### 2.5 Azure DevOps MCP 서버

**MCP (Model Context Protocol)**: AI가 외부 시스템과 직접 통신하는 표준 프로토콜. Claude Code에 ADO 조작 능력을 추가한다.

```
사용하는 MCP 도구 (주요):
├── wit_my_work_items          # 내 할당 Work Item 조회
├── wit_update_work_item       # 상태 변경 (→ In Progress)
├── repo_create_branch         # 작업 브랜치 생성
├── repo_create_pull_request   # Draft PR 생성
├── repo_get_branch_by_name    # 브랜치 존재 확인
└── wit_link_work_item_to_pull_request  # WI-PR 연결
```

**ADO 컨텍스트 고정값**:
- Organization: `https://dev.azure.com/neurophet`
- Project: `MWA`
- 브랜치 베이스: `product/hqn/main`
- PR 타겟: `product/hqn/main`

---

### 2.6 Serena MCP 서버

**역할**: 코드베이스를 파일 전체 읽기 없이 심볼(함수, 클래스, 타입) 단위로 이해하는 시맨틱 코드 탐색 도구.

```
사용하는 MCP 도구 (주요):
├── get_symbols_overview       # 파일/디렉토리의 심볼 목록 개요
├── find_symbol                # 특정 심볼 검색 (name_path 기반)
├── find_referencing_symbols   # 심볼 참조처 역추적
├── replace_symbol_body        # 심볼 본문 통째로 교체
├── insert_after_symbol        # 심볼 뒤에 코드 삽입
└── rename_symbol              # 심볼 안전 리네임
```

**핵심 장점**: `CTAMultiViewer.tsx` 같은 대형 파일도 전체를 읽지 않고 필요한 함수/컴포넌트만 타겟해서 읽고 수정. 토큰 낭비 없이 정확한 수정 가능.

**Serena 메모리**: 세션 간 코드베이스 맥락 보존
```
~/.claude/projects/-Users-cheesu-IdeaProjects-neo-frontend/
└── memory/    # Serena가 관리하는 코드베이스 지식
```

---

### 2.7 에이전트 서브프로세스 아키텍처

Claude Code의 `Agent` 도구로 독립 서브에이전트를 스폰. 각 에이전트는 완전히 독립된 컨텍스트를 가진다.

```
메인 Claude (Sonnet, 오케스트레이터)
    ├── [병렬] planner-opus-4_6  ─── ADO 조회 + 코드베이스 분석
    ├── [순차] implementer-sonnet ─── 실제 구현
    └── [순차] reviewer-opus-4_6 ─── 완료 후 리뷰
```

**서브에이전트 격리**: `isolation: "worktree"` 옵션으로 임시 git worktree에서 작업 가능 (실험적 변경사항 격리).

---

### 2.8 자동 메모리 시스템

`~/.claude/projects/-Users-cheesu-IdeaProjects-neo/memory/` 에 마크다운 파일로 저장.

**메모리 타입**:
| 타입 | 내용 | 예시 |
|------|------|------|
| `user` | 사용자 역할/선호/지식 수준 | "TypeScript 숙련, VTK.js 처음" |
| `feedback` | 지난 대화에서 받은 피드백 | "요약 불필요, 결과만 짧게" |
| `project` | 현재 진행 중인 작업 맥락 | "CTA 3D 렌더링 POC 진행 중" |
| `reference` | 외부 시스템 위치 정보 | "ADO project = MWA" |

세션이 끊겨도 다음 대화에서 이전 맥락을 복원.

---

### 2.9 브라우저 도구 MCP

```
mcp__browser-tools__takeScreenshot      # UI 스크린샷
mcp__browser-tools__getConsoleErrors    # 브라우저 콘솔 에러 수집
mcp__browser-tools__runAccessibilityAudit  # 접근성 감사
```

구현 후 실제 브라우저에서 시각적 검증 가능.

---

## 3. 전체 기술 스택 요약

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code CLI                          │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │   CLAUDE.md      │  │     remote-settings.json         │  │
│  │  (행동 규칙서)    │  │  (회사 정책: model=sonnet)        │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Skills (커스텀 명령어)                    │   │
│  │  hqn-ado-pickup-task / hqn-ado-finish-task /         │   │
│  │  hqn-frontend-guardrails                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │ planner-opus   │  │implementer-    │  │reviewer-opus │   │
│  │ (Opus 4.6)     │  │sonnet          │  │(Opus 4.6)    │   │
│  │ 분석/계획       │  │(Sonnet 4.6)    │  │리뷰/검증      │   │
│  └───────┬────────┘  │ 구현/실행       │  └──────────────┘   │
│          │           └────────────────┘                     │
└──────────┼──────────────────────────────────────────────────┘
           │
    ┌──────┼──────────────────┐
    ▼      ▼                  ▼
┌────────────┐  ┌──────────┐  ┌──────────────┐
│ Azure DevOps│  │  Serena  │  │Browser Tools │
│    MCP      │  │   MCP    │  │    MCP       │
│ Work Items  │  │ 심볼 탐색 │  │ 브라우저 검증 │
│ PR / Branch │  │ 코드 수정 │  │              │
└────────────┘  └──────────┘  └──────────────┘
```

---

## 4. 장점

### 4.1 개발자 경험 (DX) 극대화

**"일해라" 한 마디로 ADO 조회 → 브랜치 생성 → 구현 시작**까지 수동 단계가 0에 가깝다. 기존 흐름 대비:

| 항목 | 기존 수동 | 자동화 후 |
|------|---------|---------|
| ADO Work Item 조회 | 브라우저 열고 필터 → 복사 | 자동 조회 |
| 브랜치 생성 | `git checkout -b feat/xxx origin/product/hqn/main` | 자동 생성 |
| ADO 상태 변경 | 브라우저에서 클릭 | 자동 변경 |
| 커밋 메시지 작성 | 컨벤션 외우며 직접 작성 | 자동 생성 |
| Draft PR 생성 | 브라우저에서 입력 | 자동 생성 |

### 4.2 비용 최적화

Opus는 정말 필요한 곳(계획, 리뷰)에만 사용하고 반복적인 구현 작업은 Sonnet으로 처리. 프로젝트 규모가 커질수록 비용 절감 효과가 크다.

### 4.3 코드베이스 이해도 유지

Serena MCP 덕분에 파일 전체를 무지성으로 읽지 않고 심볼 단위로 탐색. 컨텍스트 창 낭비를 줄이고 더 정확한 수정 가능.

### 4.4 팀 전체 일관성

CLAUDE.md가 레포에 체크인되어 있어 팀원 누구나 동일한 워크플로우를 사용. 개인 Claude 설정이나 모델 차이와 무관하게 guardrails, 브랜치 규칙, ADO 연동이 보장된다.

### 4.5 안전 게이트 내재화

guardrails 스킬로 위험한 작업(직접 push, 확인 없는 ADO 상태 변경) 전에 반드시 사용자 확인을 받도록 강제. AI가 자율적으로 작동하면서도 사고를 방지한다.

### 4.6 메모리로 세션 간 맥락 유지

프로젝트 진행 상황, 사용자 피드백, 팀 컨벤션이 메모리에 축적되어 새 세션을 시작해도 이전 맥락을 이어받는다.

### 4.7 병렬 에이전트 활용

독립적인 작업(예: ADO 조회 + 코드베이스 분석)을 동시에 실행해 대기 시간 최소화.

---

## 5. 단점 및 한계

### 5.1 MCP 서버 의존성과 불안정성

Azure DevOps MCP, Serena MCP는 외부 서버에 의존한다. 네트워크 문제나 MCP 서버 장애 시 전체 워크플로우가 중단된다. 특히 Serena의 심볼 인덱싱이 실패하면 planner가 코드를 이해하지 못하고 잘못된 계획을 세울 수 있다.

### 5.2 Opus 비용 불예측성

planner와 reviewer가 Opus를 사용하는데, 복잡한 태스크에서 컨텍스트가 길어지면 예상보다 훨씬 많은 토큰을 소비할 수 있다. 회사 API 예산 관리가 필요하다.

### 5.3 에이전트 간 정보 손실 (핸드오프 문제)

planner → implementer 핸드오프 시 계획을 텍스트로 전달하는데, planner가 이해한 미묘한 맥락이 손실될 수 있다. implementer가 계획을 잘못 해석하면 엉뚱한 코드를 작성할 수 있다.

### 5.4 Serena 인덱싱 한계

Serena는 TypeScript의 복잡한 제네릭, 조건부 타입, 동적 import 패턴을 완전히 이해하지 못할 수 있다. Next.js의 페이지 라우팅이나 VTK.js 같은 특수 라이브러리 패턴은 심볼 탐색이 부정확할 수 있다.

### 5.5 자연어 라우팅의 모호성

CLAUDE.md의 자연어 패턴 매칭은 완벽하지 않다. "일해라"의 의도를 명확히 해석하지 못하거나 엉뚱한 플로우로 진입할 수 있다. 특히 새 팀원이 익숙하지 않은 표현을 쓰면 오해가 생길 수 있다.

### 5.6 확인 게이트로 인한 속도 저하

안전을 위해 여러 단계에서 사용자 확인을 요구한다. 빠르게 반복 작업을 하는 상황에서는 오히려 흐름이 끊길 수 있다. "빠르게 해줘"라고 해도 guardrails가 확인을 강제한다.

### 5.7 복잡한 설정 유지보수

CLAUDE.md, skills, remote-settings.json, 에이전트 정의 등 설정 파일이 분산되어 있다. 팀이 커지거나 워크플로우가 변경될 때 여러 파일을 동시에 관리해야 한다. 설정 불일치가 발생하면 원인 추적이 어렵다.

### 5.8 브랜치/ADO 상태의 부분 실패 위험

브랜치를 생성했지만 ADO 상태 변경이 실패하거나, ADO는 변경됐지만 브랜치 생성이 실패하는 등 원자성이 보장되지 않는다. 이런 상황이 발생하면 수동으로 정리해야 한다.

### 5.9 LLM 비결정성

같은 태스크라도 실행할 때마다 구현 방식이 달라질 수 있다. 특히 Sonnet implementer가 생성하는 코드 스타일이 일관되지 않을 수 있어 코드 리뷰 부담이 남아있다.

---

## 6. 워크플로우 실행 예시

```
# 사용자 입력
> 일해라

# planner-opus-4_6 실행
→ ADO MCP: wit_my_work_items 호출
→ 할당된 Work Item 목록 표시:
  #68900 - CTA 3D 렌더링 프리셋 기능 구현
  #68901 - 세그멘테이션 투명도 슬라이더 개선

# 사용자 선택
> 68900

# 확인 게이트 #1
Claude: "#68900 CTA 3D 렌더링 프리셋 기능 구현을 시작할까요?
        브랜치: feature/hqn/68900-cta-preset
        베이스: product/hqn/main"
> 네

# planner-opus-4_6
→ Serena: get_symbols_overview("src/products/hqn/components/analysis/result/content/cta/")
→ find_symbol("CTAMultiViewer", include_body=False, depth=1)
→ 영향 심볼 파악 후 구현 계획 작성

# implementer-sonnet
→ 계획에 따라 파일 수정
→ yarn lint 실행
→ 빌드 검증

# 사용자 입력
> 마무리

# reviewer-opus-4_6
→ 변경사항 전체 검토
→ guardrails 준수 확인

# 확인 게이트 #2
Claude: "변경 파일: CTAMultiViewer.tsx, CTAPresetPanel.tsx
         커밋하고 Draft PR을 생성할까요?"
> 네

# neo-commit-helper + ADO MCP
→ 커밋: "[HQN][CTA]✨feat: 3D 렌더링 프리셋 기능 구현 [#68900]"
→ push origin feature/hqn/68900-cta-preset
→ repo_create_pull_request: Draft PR → product/hqn/main
→ wit_link_work_item_to_pull_request: WI #68900 연결
```

---

## 7. 구성 파일 위치 참조

| 파일/디렉토리 | 위치 | 역할 |
|-------------|------|------|
| 전사 규칙 | `/Users/cheesu/IdeaProjects/neo/CLAUDE.md` | 프로젝트 전체 AI 규칙 |
| HQN FE 규칙 | `/Users/cheesu/IdeaProjects/neo/frontend/CLAUDE.md` | HQN 프론트엔드 특화 규칙 |
| 원격 정책 | `~/.claude/remote-settings.json` | 회사 Claude 정책 (model=sonnet 등) |
| 로컬 설정 | `~/.claude/settings.local.json` | 개인 권한 설정 |
| 커스텀 스킬 | `~/.claude/skills/` | pickup/finish/guardrails |
| 메모리 | `~/.claude/projects/-Users-cheesu-IdeaProjects-neo/memory/` | 세션 간 프로젝트 맥락 |
