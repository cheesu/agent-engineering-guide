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
})();
