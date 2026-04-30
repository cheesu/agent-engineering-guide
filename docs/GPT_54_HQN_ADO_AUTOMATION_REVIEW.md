# GPT_54 HQN ADO 자동화 흐름 점검 보고서

## 개요

이 문서는 Claude Code 기반 HQN frontend 자동화 흐름을 점검한 결과를 정리한 보고서다.

검토 대상은 다음과 같다.

- 자연어 라우팅 규칙
- pickup / tasks / finish 스킬
- HQN frontend guardrails
- hook 기반 셸/파일 편집 차단 로직
- approval token 기반 시작/마무리 승인 구조
- Azure DevOps 연동 방식
- commit / push / Draft PR 생성 흐름

핵심 목적은 아래 4가지를 판단하는 것이다.

1. 실제로 안전하게 강제되는 부분과 문서상으로만 강제되는 부분이 무엇인지
2. 운영 중 사고로 이어질 수 있는 리스크가 무엇인지
3. 중복 지시나 과도한 토큰 사용이 있는지
4. 개선한다면 어떤 순서와 방식이 가장 효율적인지

---

## 결론 요약

현재 구조는 방향 자체는 좋다.

- `product/hqn/main` 기준 branch base 무결성 의식이 있다
- 시작 승인과 종료 승인 게이트가 있다
- Draft PR 강제 의도가 있다
- commit / PR 포맷 일관성도 잘 정리되어 있다

하지만 가장 중요한 문제는 다음 한 줄로 요약된다.

> 정책 설계는 좋지만, 실제 강제 범위가 좁고, 일부 경로에서는 우회가 가능하며, 같은 규칙이 너무 많은 파일에 중복되어 있다.

특히 아래 3가지는 우선순위가 매우 높다.

1. `MCP 기반 Azure DevOps 변경 작업`이 훅 검증을 우회할 수 있음
2. `frontend` 디렉터리 밖에서 실행한 셸 명령은 가드가 비활성화될 수 있음
3. approval token이 `1회성 사용자 승인`으로 강하게 묶여 있지 않음

이 3가지는 무시하면 안 된다.

---

## 검토 대상 파일

- `.claude/hooks/scripts/hqn_guard_shell.py`
- `.claude/hooks/scripts/hqn_start_approval.py`
- `.claude/hooks/scripts/hqn_finish_approval.py`
- `.claude/hooks/scripts/hqn_protect_paths.py`
- `.claude/hooks/scripts/hqn_after_edit_context.py`
- `.claude/settings.local.json`
- `.claude/skills/hqn-frontend-guardrails/SKILL.md`
- `.claude/skills/hqn-ado-pickup-task/SKILL.md`
- `.claude/skills/hqn-ado-finish-task/SKILL.md`
- `.claude/skills/pickup/SKILL.md`
- `.claude/skills/finish/SKILL.md`
- `.claude/skills/tasks/SKILL.md`
- `frontend/CLAUDE.md`
- `.cursor/rules/hqn_ado_local_router.mdc`
- `.cursor/rules/frontend_commit_pr_guide.mdc`
- `.cursor/skills/frontend-commit-pr-message/SKILL.md`

---

## 주요 리스크 분석

### 1. MCP 기반 변경 작업이 훅 검증을 우회할 수 있음

### 판단

`높음`

### 이유

현재 hook 설정은 `Bash`와 `Edit|Write`에 대해서만 PreToolUse 검증을 수행한다.
그런데 Azure DevOps 관련 MCP 도구는 별도로 허용되어 있고, 이 경로에는 `hqn_guard_shell.py`의 승인 검증이 걸리지 않는다.

즉 다음 같은 작업은 문서상 승인 게이트가 있어 보여도, 실제로는 Bash 훅을 통과하지 않고 실행될 수 있다.

- work item 상태 변경
- branch 생성
- PR 생성

### 왜 중요한가

이 자동화의 핵심은 "사용자 승인 후에만 상태 변경/브랜치/PR 생성"이어야 한다.
그런데 MCP가 우회 경로가 되면 안전장치가 "항상" 적용되지 않는다.
이건 운영 신뢰도를 떨어뜨리는 가장 큰 문제다.

### 권장 대응

- 변경성 Azure DevOps 작업은 당분간 `Bash + az` 경로로만 통일
- 또는 MCP 전용 검증 훅을 별도로 설계
- 최소한 아래 작업은 동일한 승인 검증을 강제
  - work item update
  - branch create
  - PR create

### 무시 가능 여부

`무시하면 안 됨`

---

### 2. frontend 밖 cwd에서는 셸 가드가 꺼질 수 있음

### 판단

`높음`

### 이유

`hqn_guard_shell.py`는 현재 working directory가 `frontend` 하위가 아니면 바로 종료한다.
그런데 실제 git 작업은 저장소 루트인 `neo`에서 실행되는 경우도 매우 흔하다.

그 경우 아래 검증이 전부 빠질 수 있다.

- destructive git 차단
- HQN branch 생성 검증
- completion approval 검증
- Draft PR target branch 검증

### 왜 중요한가

가장 많이 쓰는 작업 위치에서 안전장치가 꺼진다면, 훅이 있어도 실제 운영 안전성은 크게 떨어진다.

### 권장 대응

- 훅 적용 범위를 `frontend`가 아니라 `repo root` 기준으로 확대
- 또는 repo root에서 실행해도 동일 검증이 되도록 `cwd` 판단 로직 수정
- git 관련 정책은 `FRONTEND_ROOT`보다 `REPO_ROOT` 기준으로 보는 편이 더 일관적임

### 무시 가능 여부

`무시하면 안 됨`

---

### 3. approval token이 강한 1회성 승인으로 묶여 있지 않음

### 판단

`높음`

### 이유

현재 시작/종료 승인은 로컬 JSON 파일에 저장되고 TTL 만료로만 관리된다.
그리고 검토한 범위에서는 approval state를 성공 후 자동 `clear` 하는 흐름이 보이지 않았다.

또한 finish approval 검증은 사실상 아래만 본다.

- repo
- branch
- expires_at

저장된 `work_item`은 finish 승인 검증에서 적극적으로 쓰이지 않는다.

### 왜 중요한가

한 번 승인하면 같은 branch에서 TTL 동안 여러 작업이 통과할 가능성이 생긴다.
이건 "사용자가 지금 이 커밋/푸시/PR에 동의했는가"를 강하게 보장하지 못한다.

### 권장 대응

- approval token을 `1회성`으로 변경
- commit, push, PR 성공 후 approval state 자동 `clear`
- finish approval 검증 시 아래 3개를 반드시 교차검증
  - branch 끝 번호
  - approval state의 `work_item`
  - commit message의 `[#work-item]`

### 무시 가능 여부

`무시하면 안 됨`

---

### 4. src/pages, src/shared 수정 금지가 Edit/Write에만 강제됨

### 판단

`중간~높음`

### 이유

경로 보호는 `hqn_protect_paths.py`에서 하고 있는데, 이건 `Edit|Write` matcher에만 연결되어 있다.
즉 Bash를 이용한 파일 수정 경로에는 이 금지가 그대로 적용되지 않는다.

### 왜 중요한가

정책상 절대 수정 금지인 영역이 실제로는 일부 도구 경로에서 기술적으로 막히지 않는다는 뜻이다.

### 권장 대응

- Bash 이후 변경 파일 목록을 검사하는 2차 방어 추가
- pre-commit 또는 CI에서 금지 경로 변경 감지
- 정책상 금지 영역은 훅과 CI 둘 다로 막는 방어 심층화 필요

### 무시 가능 여부

`상황에 따라 보류 가능`

작업자가 Bash로 파일 편집을 거의 하지 않는다면 당장 사고 가능성은 낮다.
하지만 자동화 안전장치로는 미완성이다.

---

### 5. pickup 흐름의 상태 변경 순서가 운영상 어긋날 수 있음

### 판단

`중간`

### 이유

문서상 pickup 목표는 work item을 먼저 `In Progress`로 바꾸고 branch를 만드는 순서로 읽힌다.
그런데 branch 생성이 실패하면 ADO 상태만 먼저 바뀌고 실제 작업 세션은 시작되지 않는 상태가 생길 수 있다.

### 왜 중요한가

치명적 보안 문제는 아니지만 운영 피로도를 높인다.
특히 팀에서 상태 기반으로 일감 현황을 보는 경우 불필요한 혼선이 생긴다.

### 권장 대응

- `base branch 검증 + branch 생성 성공` 이후에 ADO 상태를 바꾸는 순서로 재정렬
- 또는 실패 시 rollback 규칙 추가

### 무시 가능 여부

`보류 가능하지만 개선 권장`

---

### 6. local-only 파일 보호 목록이 불완전함

### 판단

`중간 이하`

### 이유

커밋 차단 대상에 일부 `.cursor` 파일과 `PR_MESSAGE.md`는 포함되어 있지만, `.claude` 자동화 파일 전반과 `frontend/CLAUDE.md`는 보호 목록에 없다.

다만 현재 환경에서는 이 파일들이 `.git/info/exclude`로 제외된 것으로 보인다.
즉 일반적인 `git add .`로는 잘 안 들어갈 가능성이 높다.

### 왜 중요한가

지금은 운 좋게 안전하지만, 명시적 `git add -f` 또는 환경 차이가 생기면 보호가 약할 수 있다.

### 권장 대응

- `.claude/**`, `frontend/CLAUDE.md` 등도 local-only 보호 목록에 추가
- git hook 또는 CI에서도 local-only 파일 커밋 여부 재확인

### 무시 가능 여부

`당장 급하진 않지만 보강 권장`

---

### 7. 문자열 기반 검증이 다소 brittle함

### 판단

`낮음`

### 이유

현재 일부 검증은 substring 또는 정규식 패턴에 크게 의존한다.

예:

- `--target-branch product/hqn/main`
- `--id 123`

이런 검증은 아래 같은 변형에 민감할 수 있다.

- `--id=123`
- 따옴표 사용
- 인자 순서 변경

### 왜 중요한가

보안 사고 가능성보다는 유지보수성과 오탐/미탐 문제가 더 크다.

### 권장 대응

- 가능하면 argument parser 수준으로 분석
- 최소한 흔한 인자 변형 패턴을 추가 지원

### 무시 가능 여부

`당장은 무시 가능`

---

## 토큰 사용과 중복 분석

현재 구조는 "안전성 확보" 명분으로 동일한 규칙이 너무 많은 파일에 반복되어 있다.

이 중복은 두 가지 비용을 만든다.

1. 매 세션/매 요청마다 불필요한 컨텍스트 토큰 증가
2. 규칙이 바뀔 때 여러 파일을 동시에 맞춰야 하는 유지보수 비용 증가

### 반복이 심한 주제

- 자연어 라우팅
  - `pickup`, `tasks`, `finish` 트리거
  - 숫자 하나 포함 시 work item 후보 해석
  - 사용자 승인 필요

- ADO 고정 컨텍스트
  - organization: `https://dev.azure.com/neurophet`
  - project: `MWA`
  - `NEO`를 project로 추정하지 말 것

- branch 무결성
  - `product/hqn/main` 기준
  - `HEAD == origin/product/hqn/main` 확인
  - compound command 금지
  - ancestry 확인

- 한국어 응답 규칙

- commit / PR 포맷 규칙
  - `[HQN][FE]<emoji><type>: ...`
  - 이모지/타입 매핑
  - PR body 템플릿

### 특히 과한 부분

#### 1. alias skill의 반복

`pickup`, `finish`, `tasks`는 본질적으로 thin wrapper여야 한다.
그런데 현재는 본문에 이미 풀 스킬의 요약이 다시 들어가 있다.

#### 2. commit / PR 규칙의 다중 중복

아래 파일들이 거의 같은 내용을 다른 표현으로 반복한다.

- `.claude/skills/hqn-ado-finish-task/SKILL.md`
- `.claude/skills/hqn-frontend-guardrails/SKILL.md`
- `.cursor/rules/frontend_commit_pr_guide.mdc`
- `.cursor/skills/frontend-commit-pr-message/SKILL.md`

#### 3. PR 본문 템플릿의 중복

finish skill 내부에 PR body template가 여러 번 서술되어 있어 토큰 낭비가 크다.

#### 4. planner / reviewer 호출의 상시화

- pickup 때 `planner-opus-4_6`
- finish 때 `reviewer-opus-4_6`

이 방식은 품질 면에서는 강하지만 비용도 높다.
특히 모든 pickup에 planner를 무조건 붙이는 것은 trivial task에는 과할 수 있다.

---

## 개선 우선순위

### P0. 반드시 먼저 고칠 것

1. 변경성 ADO 작업의 MCP 우회 제거
2. repo root 기준으로 셸 가드 범위 확대
3. approval token을 1회성으로 변경하고 성공 후 clear
4. finish approval에 `work_item` 교차검증 추가

### P1. 안정성 보강

1. Bash 기반 경로 수정 우회에 대한 2차 방어 추가
2. local-only 파일 보호 목록 확장
3. pickup 순서 재정렬
4. 실패 시 rollback / stop condition 명확화

### P2. 토큰/유지보수 최적화

1. 라우팅 규칙 중복 제거
2. ADO 컨텍스트 중복 제거
3. commit / PR 규칙의 canonical source 단일화
4. alias skill을 thin wrapper로 축소
5. planner 호출을 조건부로 변경

---

## 권장 설계 방향

### 방향 1. 강제 로직과 설명 문서를 분리

- 강제는 hook / approval script / CI가 맡음
- 설명은 skill / rule 문서가 맡음

지금은 문서가 매우 자세하지만, 기술적 강제 범위와 문서 범위가 어긋나는 지점이 있다.
이 둘을 구분해서 정리해야 한다.

### 방향 2. canonical source를 줄이기

추천 구조는 아래와 같다.

- `frontend/CLAUDE.md`
  - 자연어 라우팅 요약만

- `.cursor/rules/hqn_ado_local_router.mdc`
  - 라우팅 트리거만

- `.claude/skills/hqn-frontend-guardrails/SKILL.md`
  - 공통 안전 원칙의 단일 원천

- `.claude/skills/hqn-ado-pickup-task/SKILL.md`
  - pickup 절차의 단일 원천

- `.claude/skills/hqn-ado-finish-task/SKILL.md`
  - finish 절차의 단일 원천

- `.cursor/rules/frontend_commit_pr_guide.mdc`
  - commit / PR 형식의 단일 원천

- `.cursor/skills/frontend-commit-pr-message/SKILL.md`
  - 위 가이드를 실제 메시지 생성용으로만 참조

### 방향 3. alias skill은 정말 얇게 유지

예:

- `pickup`: guardrails 읽고 full pickup skill 호출
- `finish`: guardrails 읽고 full finish skill 호출
- `tasks`: guardrails 읽고 tasks listing flow 호출

이외의 세부 규칙은 alias에 중복하지 않는 것이 좋다.

### 방향 4. planner는 조건부로만 호출

planner는 아래 조건에서만 쓰는 것이 효율적이다.

- 영향 파일이 여러 개 예상될 때
- 범위가 불분명할 때
- 사용자 요구가 모호할 때
- HQN 결과/뷰어/승인 흐름처럼 리스크가 큰 영역일 때

반대로 trivial fix, 문구 수정, 한 파일 변경 정도는 planner 없이 진행해도 될 가능성이 높다.

---

## 무시 가능 / 무시 불가 정리

### 무시하면 안 되는 것

- MCP 우회 가능성
- repo root에서 셸 가드 비활성화 가능성
- approval token 재사용 가능성

### 상황 따라 보류 가능한 것

- Bash 편집 경로 우회
- pickup 상태 변경 순서
- local-only 파일 보호 목록 보강

### 당장 무시 가능한 것

- 일부 regex / substring 기반 검증의 brittleness
- 문서 중복 자체

단, 문서 중복은 당장 보안 문제는 아니지만 장기적으로는 반드시 정리하는 편이 좋다.

---

## 최종 평가

현재 자동화는 "철학"과 "의도"는 매우 잘 잡혀 있다.
특히 아래는 좋게 평가할 수 있다.

- HQN branch naming discipline
- `product/hqn/main` base integrity 의식
- 사용자 승인 게이트 개념
- Draft PR 강제 의도
- commit / PR message 표준화

하지만 실제 운영 품질 기준으로 보면 아래 문제가 남아 있다.

1. 가장 중요한 안전장치가 모든 실행 경로에 동일하게 적용되지 않는다
2. 승인 토큰이 작업 단위로 단단히 묶여 있지 않다
3. 같은 규칙이 너무 많은 파일에 중복되어 토큰과 유지보수 비용이 크다

따라서 현재 상태는 다음처럼 평가하는 것이 적절하다.

> "좋은 내부 운영 자동화 초안" 단계이며, 팀 차원의 신뢰 가능한 자동화로 쓰기 위해서는 enforcement boundary와 token lifecycle을 먼저 보강해야 한다.

---

## 추천 실행 순서

1. `hqn_guard_shell.py` 적용 범위를 repo root 기준으로 수정
2. ADO 변경성 작업의 MCP 우회 차단 또는 MCP 전용 검증 추가
3. approval token을 1회성 + 성공 후 clear 구조로 변경
4. finish approval에 `work_item` 교차검증 추가
5. Bash 수정 경로에 대한 금지 경로 2차 방어 추가
6. 규칙/스킬 중복을 줄여 canonical source 정리
7. planner 상시 호출 여부 재설계

---

## 부록: 한 줄 요약

이 자동화는 방향은 좋지만, 지금 상태 그대로는 "문서상 안전"에 비해 "실제 강제력"이 약한 부분이 있고, 중복 규칙이 많아 토큰과 유지보수 비용이 불필요하게 크다.
