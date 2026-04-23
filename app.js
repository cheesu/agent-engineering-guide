/* ═══════════════════════════════════════════════════════════════
   Claude Code Engineering — Presentation App
   - 3-tab deck navigation
   - Per-slide transition with keyboard + buttons + dots
   - Raw MD overlay (loaded via fetch + marked.js)
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ──────────────────────────── State ────────────────────────────
  const MD_FILES = {
    workflow: 'CLAUDE_CODE_WORKFLOW.md',
    model: 'CLAUDE_CODE_MODEL_SPLIT.md',
    harness: 'CLAUDE_CODE_HARNESS_ENGINEERING.md',
  };

  const state = {
    currentTab: 'workflow',
    // slide index per tab (persists when switching)
    slideIndex: { workflow: 0, model: 0, harness: 0 },
    rawCache: {}, // cache fetched md content
  };

  // ──────────────────────────── Elements ────────────────────────────
  const tabButtons = document.querySelectorAll('.tab-btn');
  const decks = document.querySelectorAll('.deck');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const currentSlideEl = document.getElementById('currentSlide');
  const totalSlidesEl = document.getElementById('totalSlides');
  const progressFill = document.getElementById('progressFill');
  const dotsContainer = document.getElementById('dots');

  const overlay = document.getElementById('rawOverlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayBody = document.getElementById('overlayBody');

  // ──────────────────────────── Helpers ────────────────────────────
  const getActiveDeck = () =>
    document.querySelector(`.deck[data-deck="${state.currentTab}"]`);

  const getSlides = () =>
    getActiveDeck().querySelectorAll('.slide');

  const totalSlides = () => getSlides().length;

  const currentIdx = () => state.slideIndex[state.currentTab];

  // ──────────────────────────── Render ────────────────────────────
  function renderSlide() {
    const slides = getSlides();
    const idx = currentIdx();

    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === idx);
      if (i === idx) {
        slide.scrollTop = 0;
      }
    });

    currentSlideEl.textContent = idx + 1;
    totalSlidesEl.textContent = slides.length;
    progressFill.style.width = `${((idx + 1) / slides.length) * 100}%`;

    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === slides.length - 1;

    renderDots();
  }

  function renderDots() {
    const total = totalSlides();
    const idx = currentIdx();
    dotsContainer.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('button');
      dot.className = 'dot' + (i === idx ? ' active' : '');
      dot.setAttribute('aria-label', `슬라이드 ${i + 1}`);
      dot.addEventListener('click', () => {
        state.slideIndex[state.currentTab] = i;
        renderSlide();
      });
      dotsContainer.appendChild(dot);
    }
  }

  function renderTab() {
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.currentTab);
    });
    decks.forEach((deck) => {
      deck.classList.toggle('active', deck.dataset.deck === state.currentTab);
    });
    renderSlide();
  }

  // ──────────────────────────── Navigation ────────────────────────────
  function next() {
    const idx = currentIdx();
    if (idx < totalSlides() - 1) {
      state.slideIndex[state.currentTab] = idx + 1;
      renderSlide();
    }
  }

  function prev() {
    const idx = currentIdx();
    if (idx > 0) {
      state.slideIndex[state.currentTab] = idx - 1;
      renderSlide();
    }
  }

  function switchTab(tab) {
    if (!(tab in MD_FILES)) return;
    state.currentTab = tab;
    renderTab();
  }

  // ──────────────────────────── Overlay ────────────────────────────
  async function openOverlay(tabKey) {
    const file = MD_FILES[tabKey];
    if (!file) return;

    overlayTitle.textContent = file;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';

    if (state.rawCache[tabKey]) {
      overlayBody.innerHTML = state.rawCache[tabKey];
      overlayBody.scrollTop = 0;
      return;
    }

    overlayBody.innerHTML = '<p class="loading">로딩 중...</p>';

    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      // Prefer marked if loaded; otherwise fall back to <pre>
      let html;
      if (typeof marked !== 'undefined') {
        marked.setOptions({
          breaks: false,
          gfm: true,
        });
        html = marked.parse(text);
      } else {
        html = `<pre>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`;
      }

      state.rawCache[tabKey] = html;
      overlayBody.innerHTML = html;
      overlayBody.scrollTop = 0;
    } catch (err) {
      overlayBody.innerHTML =
        `<p class="loading" style="color: var(--red);">
           마크다운 파일을 불러올 수 없습니다: ${file}<br/>
           <span style="font-size:12px; color: var(--text-3);">${err.message}</span><br/><br/>
           <span style="font-size:12px;">로컬에서 열 때는 file:// 프로토콜 제한이 있을 수 있습니다.<br/>
           간단한 HTTP 서버로 실행하세요: <code>python3 -m http.server 8000</code></span>
         </p>`;
    }
  }

  function closeOverlay() {
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  // ──────────────────────────── Events ────────────────────────────
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  // "원본 보기" buttons on each tab's last slide
  document.querySelectorAll('.view-raw-btn').forEach((btn) => {
    btn.addEventListener('click', () => openOverlay(btn.dataset.raw));
  });

  // Overlay close handlers
  overlay.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', closeOverlay);
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    // Close overlay first if open
    if (!overlay.hidden) {
      if (e.key === 'Escape') {
        closeOverlay();
      }
      return;
    }

    // Don't hijack typing in inputs (none here, but safe)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        prev();
        break;
      case 'Home':
        e.preventDefault();
        state.slideIndex[state.currentTab] = 0;
        renderSlide();
        break;
      case 'End':
        e.preventDefault();
        state.slideIndex[state.currentTab] = totalSlides() - 1;
        renderSlide();
        break;
      case '1':
        switchTab('workflow');
        break;
      case '2':
        switchTab('model');
        break;
      case '3':
        switchTab('harness');
        break;
    }
  });

  // Click-to-navigate on slide edges (left/right 10%)
  // Disabled: too magical. Users prefer explicit buttons + keyboard.

  // Initial render
  renderTab();

  // ──────────────────────────── Tooltip Glossary ────────────────────────────

  const GLOSSARY = [
    { term: 'Draft PR',      def: '아직 완성되지 않은 임시 Pull Request. 리뷰 요청 전 단계로 팀 공유용으로 생성' },
    { term: 'Work Item',     def: 'ADO에서 관리하는 작업 단위. "이 기능 만들어줘", "이 버그 고쳐줘" 같은 일감 카드' },
    { term: '오케스트레이션',  def: '여러 에이전트의 실행 순서·모델·도구 접근을 중앙에서 조율하는 구조. CLAUDE.md + Claude Code CLI가 이 역할을 담당' },
    { term: '오케스트레이터',  def: '여러 에이전트들의 작업을 총괄 지휘하는 상위 에이전트' },
    { term: '훅',             def: 'Claude가 도구를 사용하기 직전·직후에 자동으로 끼어들어 실행되는 스크립트. Claude의 판단과 무관하게 물리적으로 동작을 차단하거나 정보를 주입할 수 있음' },
    { term: '핸드오프',       def: '에이전트 간 작업 인수인계. Planner가 분석한 내용을 Implementer에게 전달하는 것' },
    { term: 'PreToolUse',    def: 'Claude가 도구를 실행하기 직전에 자동으로 끼어드는 훅. 조건 불충족 시 도구 실행 자체를 차단 가능' },
    { term: 'PostToolUse',   def: 'Claude가 도구를 실행한 직후에 자동으로 끼어드는 훅. 실행 결과에 따라 추가 정보를 Claude 컨텍스트에 주입 가능' },
    { term: 'frontmatter',   def: '마크다운 파일 맨 위 ---로 감싼 설정 영역. 모델·도구 등 메타 정보를 선언' },
    { term: 'Skills',        def: '.claude/skills/ 아래 마크다운으로 작성하는 재사용 가능한 지시 묶음. Claude가 특정 태스크를 수행할 때 자동으로 로드되며, 커밋 형식·ADO 연동·가이드라인 등을 선언적으로 정의' },
    { term: '스킬',          def: '.claude/skills/ 아래 마크다운으로 작성하는 재사용 가능한 지시 묶음. Claude가 특정 태스크를 수행할 때 자동으로 로드되며, 커밋 형식·ADO 연동·가이드라인 등을 선언적으로 정의' },
    { term: 'guardrails',    def: 'AI가 하면 안 되는 행동을 막는 안전 장치/규칙 모음' },
    { term: 'Serena',        def: '코드베이스의 함수·클래스 등을 심볼 단위로 탐색하는 MCP 서버. 대형 파일 전체 읽기 없이 필요한 부분만 접근 가능' },
    { term: 'Sonnet',        def: 'Claude의 균형형 모델. Opus보다 빠르고 저렴하며 반복 구현 작업에 적합' },
    { term: 'Opus',          def: 'Claude의 고성능 모델. 복잡한 분석·계획에 특화되며 비용이 더 높음' },
    { term: 'ADO',           def: 'Azure DevOps — MS가 만든 개발 협업 플랫폼. 이슈 관리, 코드 저장, CI/CD 등 통합 제공' },
    { term: 'MCP',           def: 'Model Context Protocol — AI 모델이 외부 도구(파일, API 등)에 접근할 수 있게 해주는 통신 규약' },
    { term: 'CLI',           def: 'Command Line Interface — 마우스 대신 텍스트 명령어로 컴퓨터를 조작하는 방식 (터미널)' },
    { term: 'TTL',           def: 'Time To Live — 유효 시간. 예: TTL 1h = 1시간 후 자동 만료' },
    { term: 'LLM',           def: 'Large Language Model — GPT, Claude 같은 대형 언어 AI 모델' },
    { term: 'DX',            def: 'Developer Experience — 개발자의 작업 편의성과 경험' },
    { term: 'PR',            def: 'Pull Request — 내가 작성한 코드를 메인 브랜치에 합쳐달라고 요청하는 것' },
    { term: 'finish_approval 토큰', def: '커밋·푸시·PR 생성 직전에 필요한 승인 파일. 사람이 CLI로 직접 발급하며 TTL 2시간' },
    { term: 'start_approval 토큰',  def: '브랜치 생성·ADO 상태 변경 직전에 필요한 승인 파일. 사람이 CLI로 직접 발급하며 TTL 1시간' },
    { term: '승인 토큰',       def: '사용자의 허락을 JSON 파일로 증명하는 것. Claude의 판단과 무관하게 사람이 직접 CLI를 실행해야 생성되며, TTL이 지나면 자동 만료' },
    { term: '토큰',           def: '문맥에 따라 두 가지 의미로 쓰임:<br><br><b>① AI 처리 단위</b> — LLM이 텍스트를 쪼개는 최소 단위. 많이 사용할수록 API 비용 증가 (토큰 볼륨, 비용 최적화 맥락)<br><br><b>② 승인 토큰</b> — 사용자 허락을 담은 JSON 파일. 브랜치 생성·커밋·PR 전 훅이 검증하며, TTL 초과 시 자동 만료 (하네스 맥락)' },
  ];

  // Build case-insensitive lookup map
  const ttDefMap = {};
  GLOSSARY.forEach(g => { ttDefMap[g.term.toLowerCase()] = g; });

  // File extension tooltips (file tree section)
  ttDefMap['ext-py']   = { term: 'Python (.py)', def: '훅이 하는 일들이 표준 라이브러리와 딱 맞아 떨어짐:<br><br><b>① json</b> — 승인 토큰 파싱 필수. Bash는 jq 같은 외부 도구 필요, Python은 <code>import json</code> 한 줄로 끝<br><br><b>② pathlib.resolve()</b> — 심볼릭 링크·../ 우회를 완벽 차단. Bash로는 엣지케이스 처리가 까다로움<br><br><b>③ re (정규식)</b> — git reset --hard 패턴, 브랜치명 검증, compound command(&&/;) 감지<br><br><b>④ time</b> — TTL expires_at 비교·만료 시간 계산<br><br><span style="color:var(--amber)">⚠ 단점:</span> 매 도구 호출마다 Python 프로세스 fork → 누적 지연. "편의성 &gt; 성능" 트레이드오프' };
  ttDefMap['ext-json'] = { term: 'JSON (.json)', def: '승인 토큰을 구조화된 데이터로 저장. 사람이 직접 열어서 읽고 확인 가능하며, Python에서 한 줄로 파싱 가능. repo·work_item·expires_at 등 여러 필드를 하나의 파일로 관리' };

  // Sort longest first so 'Draft PR' is matched before 'PR', etc.
  GLOSSARY.sort((a, b) => b.term.length - a.term.length);

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ASCII-only terms use \b word boundaries to avoid matching inside words (e.g. 'PR' in 'protect')
  function termPattern(term) {
    const escaped = escapeRe(term);
    return /^[\x00-\x7F]+$/.test(term) ? `\\b${escaped}\\b` : escaped;
  }

  const TERM_RE = new RegExp(GLOSSARY.map(g => termPattern(g.term)).join('|'), 'gi');

  // Create tooltip bubble element
  const ttBubble = document.createElement('div');
  ttBubble.id = 'tooltip-bubble';
  document.body.appendChild(ttBubble);

  function wrapTextNode(node) {
    const text = node.data;
    TERM_RE.lastIndex = 0;
    if (!TERM_RE.test(text)) return;
    TERM_RE.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = TERM_RE.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const sp = document.createElement('span');
      sp.className = 'tooltip-term';
      sp.textContent = m[0];
      sp.dataset.ttKey = m[0].toLowerCase();
      frag.appendChild(sp);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function processForTooltips(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        let el = n.parentElement;
        while (el && el !== root) {
          const t = el.tagName.toLowerCase();
          if (['code', 'pre', 'script', 'style'].includes(t) ||
              el.classList.contains('tooltip-term')) {
            return NodeFilter.FILTER_REJECT;
          }
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(wrapTextNode);
  }

  // Process all static slide content once
  document.querySelectorAll('.slide').forEach(processForTooltips);

  // ── Tooltip positioning & events ──
  let ttHideTimer = null;

  function positionTooltip(e) {
    const GAP = 16;
    const bw = ttBubble.offsetWidth || 280;
    const bh = ttBubble.offsetHeight || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = e.clientX + GAP;
    let y = e.clientY - bh - GAP;

    if (y < 8) y = e.clientY + GAP + 16; // flip below if no room above
    if (x + bw > vw - 8) x = e.clientX - bw - GAP; // flip left if overflow right
    x = Math.max(8, Math.min(x, vw - bw - 8));
    y = Math.max(8, Math.min(y, vh - bh - 8));

    ttBubble.style.left = x + 'px';
    ttBubble.style.top = y + 'px';
  }

  function getTipTarget(e) {
    return e.target.closest('.tooltip-term') || e.target.closest('.ext-tip');
  }

  document.addEventListener('mouseover', (e) => {
    const term = getTipTarget(e);
    if (!term) return;
    clearTimeout(ttHideTimer);
    const entry = ttDefMap[term.dataset.ttKey];
    if (!entry) return;
    ttBubble.innerHTML = `<span class="tt-name">${entry.term}</span>${entry.def}`;
    positionTooltip(e);
    ttBubble.classList.add('visible');
  });

  document.addEventListener('mousemove', (e) => {
    if (!ttBubble.classList.contains('visible')) return;
    if (!getTipTarget(e)) return;
    positionTooltip(e);
  });

  document.addEventListener('mouseout', (e) => {
    if (!getTipTarget(e)) return;
    clearTimeout(ttHideTimer);
    ttHideTimer = setTimeout(() => ttBubble.classList.remove('visible'), 80);
  });

})();
