/**
 * ========================================================
 * A2 Economics MCQ Practice Platform
 * Cambridge International A Level Economics Paper 1
 * Pure vanilla JS - no frameworks, no backend, fully offline
 * ========================================================
 */

const EXPLANATION_PLACEHOLDER = 'To be launched in the future.';
const IMAGE_PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const CURRENT_CHANGELOG = {
  version: 'v0.8',
  date: '2026.05.29',
  title: 'Economics MCQ Platform Updated',
  added: [
    'Added 15 sets of A2 multiple choice practice papers.',
    'Added AS Economics question bank with 240 Paper 1 multiple choice questions.',
    'Added AS chapter classification from Chapter 1 to Chapter 29.',
    'Added an Updates button so release notes can always be reopened manually.'
  ],
  fixed: [
    'Fixed the update popup so it works offline without loading external changelog files.',
    'Resolved several question image loading issues for a more stable browsing experience.'
  ],
  improved: [
    'Improved AS question navigation, answer checking, and statistics using the same workflow as A2.',
    'Improved the release notes popup experience on both desktop and mobile.',
    'Refined parts of the mobile layout for a cleaner and more consistent interface.'
  ]
};

// ========================================================
// GLOBAL APP STATE
// ========================================================
const App = {
  currentSyllabus: 'a2',
  currentView: 'home',
  currentMode: null,
  darkMode: false,
  sidebarOpen: false,
  sessionViewMode: 'active',
  currentContextKey: null,
  currentAttemptId: null,
  reviewAttemptId: null,
  hasUnsavedChanges: false,

  // Practice session state
  sessionQuestions: [],
  sessionIndex: 0,
  sessionAnswers: {},
  sessionResults: {},
  sessionLocked: {},
  explanationOpen: {},
  sessionStartTime: null,

  // Timer state
  timerActive: false,
  timerSeconds: 0,
  timerInterval: null,
  timerDuration: 0,
  imageObserver: null,
  preloadedImages: {},
  pendingPreloadHandle: null,

  // Context
  currentChapter: null,
  currentPaperId: null,

  // Data accessors for syllabus-aware question bank
  _qData() { return this.currentSyllabus === 'as' ? (typeof AS_QUESTION_DATA !== 'undefined' ? AS_QUESTION_DATA : []) : QUESTION_DATA; },
  _papers() { return this.currentSyllabus === 'as' ? (typeof AS_PAPER_INDEX !== 'undefined' ? AS_PAPER_INDEX : {}) : PAPER_INDEX; },
  _chapters() { return this.currentSyllabus === 'as' ? (typeof AS_CHAPTER_DEFINITIONS !== 'undefined' ? AS_CHAPTER_DEFINITIONS : {}) : CHAPTER_DEFINITIONS; },
  _hasData() { return this._qData().length > 0; },
  _isEmpty() { return !this._hasData(); },

  setSyllabus(syllabus) {
    if (this.currentSyllabus === syllabus) return;
    this.currentSyllabus = syllabus;
    this.sessionQuestions = [];
    this.sessionAnswers = {};
    this.sessionResults = {};
    this.sessionLocked = {};
    this.sessionIndex = 0;
    this.currentChapter = null;
    this.currentPaperId = null;
    this.currentView = 'home';
    document.querySelectorAll('[data-syllabus]').forEach(function(el) {
      el.classList.toggle('active', el.dataset.syllabus === syllabus);
    });
    this.updateBadges();
    this.renderView('home');
  },


  init() {
    this.loadSettings();
    Storage.migrateLegacyData();
    this.applyTheme();
    this.updateBadges();
    this.renderView('home');
    // Highlight A2 syllabus button on init
    document.querySelectorAll('[data-syllabus]').forEach(function(el) {
      el.classList.toggle('active', el.dataset.syllabus === 'a2');
    });
    this.registerSW();
    UpdateNotes.init();
  },

  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch((error) => {
        console.error('[UpdateNotes] Service worker registration failed:', error);
      });
    }
  },

  loadSettings() {
    try {
      const saved = localStorage.getItem('econ_mcq_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        this.darkMode = settings.darkMode || false;
      }
    } catch (e) {}
  },

  saveSettings() {
    localStorage.setItem('econ_mcq_settings', JSON.stringify({ darkMode: this.darkMode }));
  },

  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    this.saveSettings();
    this.applyTheme();
  },

  applyTheme() {
    document.documentElement.classList.toggle('dark', this.darkMode);
  },

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    document.getElementById('appLayout').classList.toggle('sidebar-open', this.sidebarOpen);
  },

  closeSidebar() {
    this.sidebarOpen = false;
    document.getElementById('appLayout').classList.remove('sidebar-open');
  },

  navigate(view, params = {}) {
    this.currentView = view;
    this.closeSidebar();
    if (view !== 'practice' && this.timerActive) this.stopTimer();

    document.querySelectorAll('.sidebar-link[data-view]').forEach(l => l.classList.remove('active'));
    const map = {
      'home': '[data-view="home"]', 'chapter-select': '[data-view="chapter-select"]',
      'paper-select': '[data-view="paper-select"]', 'random-practice': '[data-view="random-practice"]',
      'wrong-book': '[data-view="wrong-book"]', 'bookmarks': '[data-view="bookmarks"]',
      'stats': '[data-view="stats"]', 'search': '[data-view="search"]'
    };
    const sel = map[view];
    if (sel) { const el = document.querySelector('.sidebar-link' + sel); if (el) el.classList.add('active'); }

    this.renderView(view, params);
  },

  renderView(view, params = {}) {
    const wrapper = document.getElementById('contentWrapper');
    if (!wrapper) return;
    if (this._isEmpty() && view !== 'settings') {
      wrapper.innerHTML = '<div class="page-header"><h2>&#x1F4D8; AS Economics</h2><p>Coming Soon</p></div><div class="empty-state"><div class="empty-icon">&#x1F6A7;</div><div class="empty-title">AS Economics Content Not Yet Available</div><div class="empty-text">We are working on adding AS Economics questions. Please check back later, or switch to A2 Economics for full practice access.</div><div class="empty-action"><button class="btn btn-primary" onclick="App.setSyllabus(\'a2\')">Switch to A2 Economics</button></div></div>';
      return;
    }
    const views = {
      'home': () => UIRenderer.renderHome(),
      'chapter-select': () => UIRenderer.renderChapterSelect(),
      'paper-select': () => UIRenderer.renderPaperSelect(),
      'practice': () => UIRenderer.renderPractice(),
      'random-practice': () => UIRenderer.renderRandomSetup(),
      'wrong-book': () => UIRenderer.renderWrongBook(),
      'bookmarks': () => UIRenderer.renderBookmarks(),
      'stats': () => UIRenderer.renderStats(),
      'search': () => UIRenderer.renderSearch(),
      'settings': () => UIRenderer.renderSettings()
    };
    wrapper.innerHTML = (views[view] || views['home'])();
    this.prepareViewAssets(view);
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  prepareViewAssets(view) {
    this.initializeLazyImages();
    if (view === 'practice') this.preloadUpcomingQuestionImages();
  },

  initializeLazyImages() {
    const lazyImages = document.querySelectorAll('img[data-src]');
    if (!lazyImages.length) return;

    if (!this.imageObserver && 'IntersectionObserver' in window) {
      this.imageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            this.loadLazyImage(entry.target);
            this.imageObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '240px 0px', threshold: 0.01 });
    }

    lazyImages.forEach((img) => {
      if (img.dataset.bound === 'true') return;
      img.dataset.bound = 'true';
      const rect = img.getBoundingClientRect();
      const nearViewport = rect.top < (window.innerHeight * 1.25) && rect.bottom > -200;

      if (nearViewport || !this.imageObserver) {
        this.loadLazyImage(img);
      } else {
        this.imageObserver.observe(img);
      }
    });
  },

  loadLazyImage(img) {
    if (!img || img.dataset.loaded === 'true' || img.dataset.error === 'true') return;
    const src = img.dataset.src;
    if (!src) return;

    const shell = img.closest('.question-image-shell');
    const message = shell ? shell.querySelector('.question-image-fallback') : null;
    if (shell) shell.classList.add('is-loading');

    img.onload = () => {
      img.dataset.loaded = 'true';
      delete img.dataset.error;
      img.removeAttribute('data-src');
      img.classList.remove('is-error');
      img.classList.add('is-loaded');
      if (shell) {
        shell.classList.remove('is-loading');
        shell.classList.remove('has-error');
        shell.classList.add('is-loaded');
      }
      if (message) message.hidden = true;
      this.preloadedImages[src] = 'loaded';
    };

    img.onerror = () => {
      delete img.dataset.loaded;
      img.dataset.error = 'true';
      img.classList.remove('is-loaded');
      img.classList.add('is-error');
      if (shell) {
        shell.classList.remove('is-loading');
        shell.classList.remove('is-loaded');
        shell.classList.add('has-error');
        if (message) message.hidden = false;
      }
    };

    img.src = src;
    if (img.complete) {
      if (img.naturalWidth > 0) {
        img.onload();
      } else {
        img.onerror();
      }
    }
  },

  preloadUpcomingQuestionImages() {
    if (this.pendingPreloadHandle) {
      if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(this.pendingPreloadHandle);
      } else {
        clearTimeout(this.pendingPreloadHandle);
      }
      this.pendingPreloadHandle = null;
    }

    const upcoming = [];
    for (let offset = 1; offset <= 2; offset++) {
      const question = this.sessionQuestions[this.sessionIndex + offset];
      if (!question || !question.stemImage || this.preloadedImages[question.stemImage]) continue;
      upcoming.push(question.stemImage);
    }

    if (!upcoming.length) return;

    const preload = () => {
      upcoming.forEach((src) => {
        if (this.preloadedImages[src]) return;
        this.preloadedImages[src] = 'loading';
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { this.preloadedImages[src] = 'loaded'; };
        img.onerror = () => { delete this.preloadedImages[src]; };
        img.src = src;
      });
    };

    if ('requestIdleCallback' in window) {
      this.pendingPreloadHandle = window.requestIdleCallback(preload, { timeout: 600 });
    } else {
      this.pendingPreloadHandle = window.setTimeout(preload, 150);
    }
  },

  buildQuestionImageMarkup(question) {
    const imageSrc = question && question.stemImage ? question.stemImage : '';
    if (!imageSrc) {
      return '<div class="question-image-shell has-error"><div class="question-image-fallback">Question image is unavailable.</div></div>';
    }

    const isPreloaded = this.preloadedImages[imageSrc] === 'loaded';
    const srcAttr = isPreloaded ? ' src="' + imageSrc + '"' : ' src="' + IMAGE_PLACEHOLDER_SRC + '" data-src="' + imageSrc + '"';
    const loadedClass = isPreloaded ? ' is-loaded' : '';
    return '<div class="question-image-shell' + (isPreloaded ? ' is-loaded' : ' is-loading') + '">' +
      '<div class="question-image-placeholder" aria-hidden="true">Loading question image…</div>' +
      '<div class="question-image-fallback" hidden>Image unavailable. Please try again.</div>' +
      '<img' + srcAttr + ' alt="Question ' + question.questionNum + '" class="stem-image progressive-image' + loadedClass + '" onclick="UIRenderer.openLightbox(\'' + imageSrc + '\')" loading="lazy" decoding="async" fetchpriority="high">' +
      '</div>';
  },

  updateBadges() {
    const wc = Storage.getWrongQuestions().length;
    const bc = Storage.getBookmarks().length;
    const wb = document.getElementById('wrongCountBadge');
    const bb = document.getElementById('bookmarkCountBadge');
    if (wb) { wb.textContent = wc; wb.style.display = wc > 0 ? '' : 'none'; }
    if (bb) { bb.textContent = bc; bb.style.display = bc > 0 ? '' : 'none'; }
  },

  // ---- Session Management ----
  getContextKey(mode, context = {}) {
    if (mode === 'paper' && context.paperId) return 'paper:' + context.paperId;
    if (mode === 'chapter' && context.chapter !== null && context.chapter !== undefined) return 'chapter:' + context.chapter;
    return mode + ':' + (context.id || 'default');
  },

  createSessionSnapshot(questions) {
    const total = questions.length;
    return {
      sessionId: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSavedAt: null,
      startedAt: Date.now(),
      currentQuestionIndex: 0,
      questionIds: questions.map(function(q) { return q.id; }),
      answers: {},
      results: {},
      locked: {},
      explanationOpen: {},
      progress: {
        total: total,
        answered: 0,
        correct: 0,
        incorrect: 0,
        accuracy: 0
      }
    };
  },

  calculateSessionProgress(questionIds, answers, results) {
    const total = Array.isArray(questionIds) ? questionIds.length : 0;
    const validIds = new Set(questionIds || []);
    const answeredIds = Object.keys(answers || {}).filter(function(qid) { return validIds.has(qid); });
    const answered = answeredIds.length;
    const correct = answeredIds.filter(function(qid) { return results && results[qid] === true; }).length;
    const incorrect = Math.max(0, answered - correct);
    return {
      total: total,
      answered: Math.min(answered, total),
      correct: Math.min(correct, total),
      incorrect: Math.min(incorrect, total),
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0
    };
  },

  buildSessionPayload(sessionOverride) {
    const questionIds = this.sessionQuestions.map(function(q) { return q.id; });
    const payload = Object.assign({}, sessionOverride || {}, {
      sessionId: (sessionOverride && sessionOverride.sessionId) || this.currentAttemptId || ('sess_' + Date.now()),
      status: this.sessionViewMode === 'review' ? 'completed' : 'in_progress',
      questionIds: questionIds,
      currentQuestionIndex: Math.max(0, Math.min(this.sessionIndex, Math.max(0, questionIds.length - 1))),
      answers: Object.assign({}, this.sessionAnswers),
      results: Object.assign({}, this.sessionResults),
      locked: Object.assign({}, this.sessionLocked),
      explanationOpen: Object.assign({}, this.explanationOpen),
      startedAt: this.sessionStartTime || Date.now()
    });
    payload.progress = this.calculateSessionProgress(questionIds, payload.answers, payload.results);
    payload.updatedAt = new Date().toISOString();
    if (!payload.createdAt) payload.createdAt = payload.updatedAt;
    return payload;
  },

  hydrateSessionState(mode, context, questions, sessionPayload, viewMode, attemptId) {
    this.currentMode = mode;
    this.currentChapter = context.chapter || null;
    this.currentPaperId = context.paperId || null;
    this.currentContextKey = this.getContextKey(mode, context);
    this.sessionViewMode = viewMode || 'active';
    this.currentAttemptId = attemptId || (sessionPayload && sessionPayload.sessionId) || null;
    this.reviewAttemptId = this.sessionViewMode === 'review' ? this.currentAttemptId : null;
    this.sessionQuestions = questions;
    this.sessionIndex = Math.max(0, Math.min((sessionPayload && sessionPayload.currentQuestionIndex) || 0, Math.max(0, questions.length - 1)));
    this.sessionAnswers = Object.assign({}, (sessionPayload && sessionPayload.answers) || {});
    this.sessionResults = Object.assign({}, (sessionPayload && sessionPayload.results) || {});
    this.sessionLocked = Object.assign({}, (sessionPayload && sessionPayload.locked) || {});
    this.explanationOpen = Object.assign({}, (sessionPayload && sessionPayload.explanationOpen) || {});
    this.sessionStartTime = sessionPayload && typeof sessionPayload.startedAt === 'number' ? sessionPayload.startedAt : Date.now();
    this.hasUnsavedChanges = false;
  },

  startSession(questions, mode, context = {}, options = {}) {
    if (!questions || questions.length === 0) { this.showToast('No questions available.'); return; }
    const session = this.createSessionSnapshot(questions);
    const contextKey = this.getContextKey(mode, context);
    Storage.saveActiveSession(contextKey, mode, context, session);
    this.hydrateSessionState(mode, context, questions, session, 'active', session.sessionId);
    if (context.timed && context.timerMinutes) {
      this.timerDuration = context.timerMinutes * 60;
      this.startTimer();
    }
    this.navigate('practice');
  },

  launchQuestions(config = {}) {
    const syllabus = config.syllabus || this.currentSyllabus;
    if (syllabus !== this.currentSyllabus) {
      this.setSyllabus(syllabus);
    }

    if (config.mode === 'chapter') {
      const chapter = parseInt(config.id, 10);
      if (isNaN(chapter)) {
        this.showToast('Invalid chapter number.');
        return false;
      }
      return ChapterMode.open(chapter);
    }

    if (config.mode === 'paper') {
      const paperId = typeof config.id === 'string' ? config.id.trim() : '';
      if (!paperId || !this._papers()[paperId]) {
        this.showToast('Invalid paper ID.');
        return false;
      }
      return PaperMode.open(paperId);
    }

    this.showToast('Invalid launch mode.');
    return false;
  },

  // ---- Session Persistence ----
  saveSession() {
    if (!this.currentMode || this.sessionQuestions.length === 0 || !this.currentContextKey || this.sessionViewMode !== 'active') return false;
    const payload = this.buildSessionPayload({
      sessionId: this.currentAttemptId
    });
    payload.lastSavedAt = new Date().toISOString();
    Storage.saveActiveSession(this.currentContextKey, this.currentMode, {
      chapter: this.currentChapter,
      paperId: this.currentPaperId
    }, payload);
    this.currentAttemptId = payload.sessionId;
    this.hasUnsavedChanges = false;
    return true;
  },

  resumeSession(mode, context = {}) {
    const contextKey = this.getContextKey(mode, context);
    const record = Storage.getContextRecord(contextKey);
    if (!record || !record.activeSession) {
      this.showToast('No saved session found.');
      return false;
    }
    const ordered = QuestionBank.getByIdsInOrder(record.activeSession.questionIds || []);
    if (!ordered.length) {
      Storage.clearActiveSession(contextKey);
      this.showToast('Saved session was corrupted and has been cleared.');
      return false;
    }
    this.hydrateSessionState(mode, context, ordered, record.activeSession, 'active', record.activeSession.sessionId);
    this.navigate('practice');
    return true;
  },

  reviewAttempt(mode, context = {}, attemptId) {
    const contextKey = this.getContextKey(mode, context);
    const attempt = Storage.getCompletedAttempt(contextKey, attemptId);
    if (!attempt) {
      this.showToast('Completed attempt not found.');
      return false;
    }
    const ordered = QuestionBank.getByIdsInOrder(attempt.questionIds || []);
    if (!ordered.length) {
      this.showToast('Completed attempt could not be loaded.');
      return false;
    }
    this.hydrateSessionState(mode, context, ordered, attempt, 'review', attempt.attemptId || attempt.sessionId || null);
    this.navigate('practice');
    return true;
  },

  restartSession(mode, context = {}) {
    const questions = mode === 'paper'
      ? QuestionBank.getByPaper(context.paperId)
      : QuestionBank.getByChapters(context.chapter);
    if (!questions || questions.length === 0) {
      this.showToast('No questions available.');
      return false;
    }
    return this.startSession(questions, mode, context);
  },

  clearSessionState() {
    this.currentMode = null;
    this.sessionViewMode = 'active';
    this.currentContextKey = null;
    this.currentAttemptId = null;
    this.reviewAttemptId = null;
    this.hasUnsavedChanges = false;
    this.sessionQuestions = [];
    this.sessionIndex = 0;
    this.sessionAnswers = {};
    this.sessionResults = {};
    this.sessionLocked = {};
    this.explanationOpen = {};
    this.currentChapter = null;
    this.currentPaperId = null;
    this.sessionStartTime = null;
  },

  getCurrentQuestion() { return this.sessionQuestions[this.sessionIndex] || null; },

  getExplanationId(questionId) {
    return 'exp-' + questionId.replace(/[^a-zA-Z0-9]/g, '-');
  },

  setExplanationButtonState(button, isOpen) {
    if (!button) return;
    button.classList.toggle('open', isOpen);
    button.innerHTML = '<span class="arrow">' + (isOpen ? '&#9660;' : '&#9654;') + '</span> ' + (isOpen ? 'Hide Explanation' : 'Show Explanation');
  },

  toggleExplanation(questionId) {
    const expId = this.getExplanationId(questionId);
    const content = document.getElementById(expId);
    const button = document.getElementById(expId + '-btn');
    if (!content || !button) return;

    const isOpen = content.classList.toggle('visible');
    this.explanationOpen[questionId] = isOpen;
    this.setExplanationButtonState(button, isOpen);
    if (this.sessionViewMode === 'active') this.hasUnsavedChanges = true;
  },

  buildExplanationMarkup(questionId) {
    const expId = this.getExplanationId(questionId);
    const isOpen = this.explanationOpen[questionId] || false;
    return '<button class="explanation-toggle' + (isOpen ? ' open' : '') + '" id="' + expId + '-btn" onclick="App.toggleExplanation(\'' + UIRenderer.escapeAttr(questionId) + '\')">' +
      '<span class="arrow">' + (isOpen ? '&#9660;' : '&#9654;') + '</span> ' + (isOpen ? 'Hide Explanation' : 'Show Explanation') + '</button>' +
      '<div class="explanation-content' + (isOpen ? ' visible' : '') + '" id="' + expId + '">' + EXPLANATION_PLACEHOLDER + '</div>';
  },

  attachExplanationPanel(questionId, container) {
    if (!container) return;
    const expId = this.getExplanationId(questionId);
    const oldContent = document.getElementById(expId);
    if (oldContent) oldContent.remove();
    const oldButton = document.getElementById(expId + '-btn');
    if (oldButton) oldButton.remove();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.buildExplanationMarkup(questionId);
    while (wrapper.firstChild) {
      container.appendChild(wrapper.firstChild);
    }
  },

  selectAnswer(option) {
    const q = this.getCurrentQuestion();
    if (!q || this.sessionLocked[q.id] || this.sessionViewMode === 'review') return;
    const isCorrect = option === q.answer;
    this.sessionAnswers[q.id] = option;
    this.sessionResults[q.id] = isCorrect;
    this.sessionLocked[q.id] = true;
    this.hasUnsavedChanges = true;

    if (!isCorrect) Storage.addWrongQuestion(q.id);

    this.updateAnswerUI(q, option, isCorrect);
    this.updateBadges();
    this.updatePracticeNav();
  },

  updateAnswerUI(q, sel, correct) {
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.classList.add('locked');
      const l = btn.dataset.option;
      if (l === q.answer) btn.classList.add('correct');
      if (l === sel && !correct) btn.classList.add('wrong');
    });
    const re = document.getElementById('answerResult');
    if (re) {
      re.style.display = 'block';
      re.innerHTML = correct
        ? '<span style=\"color:var(--border-correct);font-weight:700;\">✔ Correct!</span>'
        : '<span style=\"color:var(--border-wrong);font-weight:700;\">✘ Wrong.</span> Correct answer: <strong>' + q.answer + '</strong>';
      re.style.color = correct ? 'var(--text-correct)' : 'var(--text-wrong)';
      this.attachExplanationPanel(q.id, re.parentNode);
    }
    this.updatePalette();
  },

  nextQuestion() {
    if (this.sessionIndex < this.sessionQuestions.length - 1) {
      this.sessionIndex++; this.renderView('practice'); window.scrollTo({ top: 0, behavior: 'smooth' });
      if (this.sessionViewMode === 'active') this.hasUnsavedChanges = true;
    }
  },
  prevQuestion() {
    if (this.sessionIndex > 0) {
      this.sessionIndex--; this.renderView('practice'); window.scrollTo({ top: 0, behavior: 'smooth' });
      if (this.sessionViewMode === 'active') this.hasUnsavedChanges = true;
    }
  },
  jumpToQuestion(i) {
    if (i >= 0 && i < this.sessionQuestions.length) {
      this.sessionIndex = i; this.renderView('practice'); window.scrollTo({ top: 0, behavior: 'smooth' });
      if (this.sessionViewMode === 'active') this.hasUnsavedChanges = true;
    }
  },

  updatePracticeNav() {
    const p = document.getElementById('btnPrev'), n = document.getElementById('btnNext'), pr = document.getElementById('progressText');
    if (p) p.disabled = this.sessionIndex === 0;
    if (n) n.disabled = this.sessionIndex >= this.sessionQuestions.length - 1;
    const ac = Object.keys(this.sessionAnswers).length;
    if (pr) pr.innerHTML = 'Question <strong>' + (this.sessionIndex + 1) + '</strong> of <strong>' + this.sessionQuestions.length + '</strong> &middot; ' + ac + ' answered';
  },

  updatePalette() {
    const pal = document.getElementById('questionPalette');
    if (!pal) return;
    pal.querySelectorAll('.palette-dot').forEach((dot, i) => {
      dot.classList.remove('current', 'answered', 'wrong-answered');
      if (i === this.sessionIndex) dot.classList.add('current');
      const q = this.sessionQuestions[i];
      if (q && this.sessionLocked[q.id]) dot.classList.add(this.sessionResults[q.id] ? 'answered' : 'wrong-answered');
    });
  },

  // ---- Timer ----
  startTimer() {
    this.timerActive = true; this.timerSeconds = this.timerDuration; this.updateTimerDisplay();
    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      this.updateTimerDisplay();
      if (this.timerSeconds <= 0) { this.stopTimer(); this.showToast('Time is up!'); }
    }, 1000);
  },
  stopTimer() { this.timerActive = false; if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } },
  updateTimerDisplay() {
    const el = document.getElementById('timerDisplay'); if (!el) return;
    const m = Math.floor(this.timerSeconds / 60), s = this.timerSeconds % 60;
    el.textContent = m + ':' + s.toString().padStart(2, '0');
    el.classList.remove('warning', 'danger');
    if (this.timerSeconds < 60) el.classList.add('danger');
    else if (this.timerSeconds < 300) el.classList.add('warning');
  },

  saveAndExit() {
    if (this.sessionViewMode === 'active') this.saveSession();
    this.navigate('home');
    this.showToast(this.sessionViewMode === 'review' ? 'Returned to dashboard.' : 'Progress saved.');
  },

  completeAttempt() {
    if (this.sessionViewMode !== 'active' || !this.currentContextKey) return;
    this.stopTimer();
    const payload = this.buildSessionPayload({
      sessionId: this.currentAttemptId
    });
    const progress = payload.progress || this.calculateSessionProgress(payload.questionIds, payload.answers, payload.results);
    const completedAt = new Date().toISOString();
    const attempt = Object.assign({}, payload, {
      attemptId: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      status: 'completed',
      completedAt: completedAt,
      lastSavedAt: completedAt,
      timeTaken: this.sessionStartTime ? Math.round((Date.now() - this.sessionStartTime) / 1000) : 0
    });
    attempt.progress = progress;
    Storage.completeActiveSession(this.currentContextKey, this.currentMode, {
      chapter: this.currentChapter,
      paperId: this.currentPaperId
    }, attempt);
    this.clearSessionState();
    this.updateBadges();
    this.navigate('home');
    this.showToast('Attempt completed.');
  },

  getRelativeTimeLabel(timestamp) {
    if (!timestamp) return 'Never';
    const time = new Date(timestamp).getTime();
    if (!time) return 'Unknown';
    const diffSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (diffSeconds < 60) return 'just now';
    if (diffSeconds < 3600) return Math.floor(diffSeconds / 60) + ' minute' + (Math.floor(diffSeconds / 60) === 1 ? '' : 's') + ' ago';
    if (diffSeconds < 86400) return Math.floor(diffSeconds / 3600) + ' hour' + (Math.floor(diffSeconds / 3600) === 1 ? '' : 's') + ' ago';
    return Math.floor(diffSeconds / 86400) + ' day' + (Math.floor(diffSeconds / 86400) === 1 ? '' : 's') + ' ago';
  },

  getContextStatus(mode, context = {}) {
    const contextKey = this.getContextKey(mode, context);
    return Storage.getContextSummary(contextKey);
  },

  showToast(msg, dur = 2500) {
    const ex = document.querySelector('.toast'); if (ex) ex.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), dur);
  }
};

const UpdateNotes = {
  STORAGE_KEY: 'dismissedUpdateVersion',
  currentData: CURRENT_CHANGELOG,
  isOpen: false,

  init() {
    const overlay = document.getElementById('updateModalOverlay');
    if (overlay) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) this.close();
      });
    }
    const normalized = this.normalize(this.currentData);
    if (!normalized) {
      console.error('[UpdateNotes] CURRENT_CHANGELOG is invalid:', this.currentData);
      return;
    }
    this.currentData = normalized;
    this.render(normalized);
    if (this.getDismissedVersion() !== normalized.version) this.open();
  },

  normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    const date = typeof raw.date === 'string' ? raw.date.trim() : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!version || !date || !title) return null;

    const sanitizeList = (value) => Array.isArray(value)
      ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];

    return {
      version: version,
      date: date,
      title: title,
      added: sanitizeList(raw.added),
      fixed: sanitizeList(raw.fixed),
      improved: sanitizeList(raw.improved)
    };
  },

  buildSection(label, items) {
    if (!items.length) return '';
    return '<div class="update-section">' +
      '<div class="update-section-label">' + label + '</div>' +
      '<ul class="update-section-list">' + items.map((item) => '<li>' + item + '</li>').join('') + '</ul>' +
      '</div>';
  },

  render(data) {
    const versionEl = document.getElementById('updateModalVersion');
    const titleEl = document.getElementById('updateModalTitle');
    const bodyEl = document.getElementById('updateModalBody');
    if (!versionEl || !titleEl || !bodyEl) return;

    versionEl.textContent = data.date + ' · ' + data.version;
    titleEl.textContent = data.title;
    bodyEl.innerHTML =
      this.buildSection('Added', data.added) +
      this.buildSection('Fixed', data.fixed) +
      this.buildSection('Improved', data.improved);
  },

  openManual() {
    if (!this.currentData) return;
    this.open();
  },

  open() {
    if (!this.currentData) return;
    const overlay = document.getElementById('updateModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    this.isOpen = true;
  },

  close() {
    const overlay = document.getElementById('updateModalOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    this.isOpen = false;
  },

  dismissCurrentVersion() {
    if (this.currentData && this.currentData.version) {
      try {
        localStorage.setItem(this.STORAGE_KEY, this.currentData.version);
      } catch (error) {
        console.error('[UpdateNotes] Failed to save dismissed version:', error);
      }
    }
    this.close();
  },

  getDismissedVersion() {
    try {
      return localStorage.getItem(this.STORAGE_KEY) || '';
    } catch (error) {
      return '';
    }
  }
};

window.UpdateNotes = UpdateNotes;

// ========================================================
// STORAGE LAYER - All user data in localStorage
// ========================================================
const Storage = {
  _prefix() { return App.currentSyllabus === 'as' ? 'econ_as_' : 'econ_mcq_'; },
  PRACTICE_STORE_KEY: 'practice_sessions',

  _get(key) {
    try { const r = localStorage.getItem(this._prefix() + key); return r ? JSON.parse(r) : null; }
    catch (e) { return null; }
  },
  _set(key, value) {
    try { localStorage.setItem(this._prefix() + key, JSON.stringify(value)); }
    catch (e) { console.warn('Storage full'); }
  },

  safeParse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },

  getPracticeStore() {
    const existing = this._get(this.PRACTICE_STORE_KEY);
    let store = existing && typeof existing === 'object' ? existing : null;
    if (!store || typeof store.contexts !== 'object' || Array.isArray(store.contexts)) {
      store = { version: 2, contexts: {} };
    }

    const sanitized = { version: 2, contexts: {} };
    Object.keys(store.contexts || {}).forEach((contextKey) => {
      const record = this.sanitizeContextRecord(contextKey, store.contexts[contextKey]);
      if (record) sanitized.contexts[contextKey] = record;
    });

    return sanitized;
  },

  savePracticeStore(store) {
    this._set(this.PRACTICE_STORE_KEY, store);
  },

  sanitizeSessionData(session, fallbackStatus) {
    if (!session || typeof session !== 'object') return null;
    const questionIds = Array.isArray(session.questionIds) ? session.questionIds.filter(function(id) { return typeof id === 'string'; }) : [];
    if (!questionIds.length) return null;
    const validIds = new Set(questionIds);
    const answers = {};
    const results = {};
    const locked = {};
    const explanationOpen = {};

    Object.keys(session.answers || {}).forEach(function(qid) {
      if (validIds.has(qid) && typeof session.answers[qid] === 'string') answers[qid] = session.answers[qid];
    });
    Object.keys(session.results || {}).forEach(function(qid) {
      if (validIds.has(qid) && answers[qid] !== undefined && typeof session.results[qid] === 'boolean') results[qid] = session.results[qid];
    });
    Object.keys(session.locked || {}).forEach(function(qid) {
      if (validIds.has(qid) && answers[qid] !== undefined && session.locked[qid] === true) locked[qid] = true;
    });
    Object.keys(session.explanationOpen || {}).forEach(function(qid) {
      if (validIds.has(qid) && session.explanationOpen[qid] === true) explanationOpen[qid] = true;
    });

    const progress = App.calculateSessionProgress(questionIds, answers, results);
    const maxIndex = Math.max(0, questionIds.length - 1);
    const rawIndex = typeof session.currentQuestionIndex === 'number' ? session.currentQuestionIndex : 0;

    return {
      sessionId: session.sessionId || null,
      attemptId: session.attemptId || null,
      status: session.status || fallbackStatus || 'in_progress',
      createdAt: session.createdAt || null,
      updatedAt: session.updatedAt || null,
      lastSavedAt: session.lastSavedAt || null,
      startedAt: typeof session.startedAt === 'number' ? session.startedAt : null,
      completedAt: session.completedAt || null,
      timeTaken: typeof session.timeTaken === 'number' ? session.timeTaken : null,
      currentQuestionIndex: Math.max(0, Math.min(rawIndex, maxIndex)),
      questionIds: questionIds,
      answers: answers,
      results: results,
      locked: locked,
      explanationOpen: explanationOpen,
      progress: progress
    };
  },

  sanitizeContextRecord(contextKey, record) {
    if (!record || typeof record !== 'object') return null;
    const parts = contextKey.split(':');
    if (parts.length < 2) return null;
    const contextType = parts[0];
    const contextId = parts.slice(1).join(':');
    if (!contextType || !contextId) return null;

    const activeSession = this.sanitizeSessionData(record.activeSession, 'in_progress');
    const completedAttempts = Array.isArray(record.completedAttempts)
      ? record.completedAttempts
          .map((attempt) => this.sanitizeSessionData(attempt, 'completed'))
          .filter(Boolean)
      : [];

    completedAttempts.forEach(function(attempt, index) {
      if (!attempt.attemptId) attempt.attemptId = 'legacy_attempt_' + index + '_' + contextKey.replace(/[^a-zA-Z0-9]/g, '_');
      attempt.status = 'completed';
    });

    return {
      contextType: record.contextType || contextType,
      contextId: record.contextId || contextId,
      activeSession: activeSession,
      completedAttempts: completedAttempts
    };
  },

  getContextRecord(contextKey) {
    const store = this.getPracticeStore();
    return store.contexts[contextKey] || null;
  },

  createContextRecord(mode, context) {
    return {
      contextType: mode,
      contextId: mode === 'paper' ? context.paperId : context.chapter,
      activeSession: null,
      completedAttempts: []
    };
  },

  saveActiveSession(contextKey, mode, context, session) {
    const store = this.getPracticeStore();
    const record = store.contexts[contextKey] || this.createContextRecord(mode, context);
    record.contextType = mode;
    record.contextId = mode === 'paper' ? context.paperId : context.chapter;
    record.activeSession = session;
    store.contexts[contextKey] = this.sanitizeContextRecord(contextKey, record);
    this.savePracticeStore(store);
  },

  clearActiveSession(contextKey) {
    const store = this.getPracticeStore();
    if (!store.contexts[contextKey]) return;
    store.contexts[contextKey].activeSession = null;
    this.savePracticeStore(store);
  },

  completeActiveSession(contextKey, mode, context, attempt) {
    const store = this.getPracticeStore();
    const record = store.contexts[contextKey] || this.createContextRecord(mode, context);
    record.contextType = mode;
    record.contextId = mode === 'paper' ? context.paperId : context.chapter;
    record.completedAttempts = Array.isArray(record.completedAttempts) ? record.completedAttempts : [];
    record.completedAttempts.push(attempt);
    record.activeSession = null;
    store.contexts[contextKey] = this.sanitizeContextRecord(contextKey, record);
    this.savePracticeStore(store);
  },

  getCompletedAttempts(contextKey) {
    const record = this.getContextRecord(contextKey);
    return record && Array.isArray(record.completedAttempts) ? record.completedAttempts : [];
  },

  getCompletedAttempt(contextKey, attemptId) {
    const attempts = this.getCompletedAttempts(contextKey);
    if (!attemptId) return attempts.length ? attempts[attempts.length - 1] : null;
    return attempts.find(function(attempt) { return attempt.attemptId === attemptId || attempt.sessionId === attemptId; }) || null;
  },

  getContextSummary(contextKey) {
    const record = this.getContextRecord(contextKey);
    if (!record) {
      return {
        state: 'not_started',
        activeSession: null,
        latestCompleted: null
      };
    }
    const activeSession = record.activeSession || null;
    const latestCompleted = record.completedAttempts && record.completedAttempts.length
      ? record.completedAttempts[record.completedAttempts.length - 1]
      : null;
    return {
      state: activeSession ? 'in_progress' : (latestCompleted ? 'completed' : 'not_started'),
      activeSession: activeSession,
      latestCompleted: latestCompleted
    };
  },

  getAllContextRecords(prefix) {
    const store = this.getPracticeStore();
    const records = {};
    Object.keys(store.contexts || {}).forEach(function(contextKey) {
      if (!prefix || contextKey.indexOf(prefix) === 0) records[contextKey] = store.contexts[contextKey];
    });
    return records;
  },

  getAllChapterStats() {
    const all = {};
    const records = this.getAllContextRecords('chapter:');
    Object.keys(App._chapters()).forEach((ch) => {
      const record = records['chapter:' + ch];
      const latest = record && record.completedAttempts && record.completedAttempts.length
        ? record.completedAttempts[record.completedAttempts.length - 1]
        : null;
      all[ch] = latest ? latest.progress : { total: QuestionBank.getByChapters(parseInt(ch, 10)).length, answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
    });
    return all;
  },

  getAllPaperStats() {
    const all = {};
    const records = this.getAllContextRecords('paper:');
    Object.keys(App._papers()).forEach((pid) => {
      const record = records['paper:' + pid];
      const latest = record && record.completedAttempts && record.completedAttempts.length
        ? record.completedAttempts[record.completedAttempts.length - 1]
        : null;
      all[pid] = latest ? latest.progress : { total: App._papers()[pid].questionCount, answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
    });
    return all;
  },

  migrateLegacyData() {
    const store = this.getPracticeStore();
    let changed = false;

    const legacySession = this.safeParse(localStorage.getItem('econ_mcq_session'));
    if (legacySession && Array.isArray(legacySession.questionIds) && legacySession.questionIds.length) {
      const mode = legacySession.currentMode;
      const context = {
        chapter: legacySession.currentChapter,
        paperId: legacySession.currentPaperId
      };
      if ((mode === 'paper' && context.paperId) || (mode === 'chapter' && context.chapter !== null && context.chapter !== undefined)) {
        const contextKey = mode === 'paper' ? 'paper:' + context.paperId : 'chapter:' + context.chapter;
        if (!store.contexts[contextKey] || !store.contexts[contextKey].activeSession) {
          const migratedSession = {
            sessionId: 'legacy_' + Date.now(),
            status: 'in_progress',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastSavedAt: new Date().toISOString(),
            startedAt: typeof legacySession.sessionStartTime === 'number' ? legacySession.sessionStartTime : Date.now(),
            currentQuestionIndex: legacySession.sessionIndex || 0,
            questionIds: legacySession.questionIds,
            answers: legacySession.sessionAnswers || {},
            results: legacySession.sessionResults || {},
            locked: legacySession.sessionLocked || {},
            explanationOpen: legacySession.explanationOpen || {}
          };
          store.contexts[contextKey] = this.sanitizeContextRecord(contextKey, {
            contextType: mode,
            contextId: mode === 'paper' ? context.paperId : context.chapter,
            activeSession: migratedSession,
            completedAttempts: (store.contexts[contextKey] && store.contexts[contextKey].completedAttempts) || []
          });
          changed = true;
        }
      }
      localStorage.removeItem('econ_mcq_session');
    }

    const legacyAttemptKeys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf(this._prefix() + 'attempts_') !== 0) continue;
      legacyAttemptKeys.push(key);
    }

    legacyAttemptKeys.forEach((key) => {
      const rawAttempts = this.safeParse(localStorage.getItem(key));
      if (!Array.isArray(rawAttempts)) {
        localStorage.removeItem(key);
        return;
      }
      const legacyContextKey = key.slice((this._prefix() + 'attempts_').length);
      let contextKey = null;
      let mode = null;
      let contextId = null;
      if (legacyContextKey.indexOf('ch_') === 0) {
        mode = 'chapter';
        contextId = legacyContextKey.slice(3);
        contextKey = 'chapter:' + contextId;
      } else {
        mode = 'paper';
        contextId = legacyContextKey;
        contextKey = 'paper:' + contextId;
      }
      const record = store.contexts[contextKey] || {
        contextType: mode,
        contextId: contextId,
        activeSession: null,
        completedAttempts: []
      };
      if (!record.completedAttempts || !record.completedAttempts.length) {
        record.completedAttempts = rawAttempts.map((attempt) => {
          const derivedQuestionIds = Array.isArray(attempt.questionIds) && attempt.questionIds.length
            ? attempt.questionIds
            : (mode === 'paper'
              ? QuestionBank.getByPaper(contextId).map(function(q) { return q.id; })
              : QuestionBank.getByChapters(parseInt(contextId, 10)).map(function(q) { return q.id; }));
          return {
            attemptId: 'legacy_attempt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            sessionId: attempt.sessionId || null,
            status: 'completed',
            createdAt: attempt.date || null,
            updatedAt: attempt.date || null,
            lastSavedAt: attempt.date || null,
            startedAt: null,
            completedAt: attempt.date || null,
            timeTaken: typeof attempt.timeTaken === 'number' ? attempt.timeTaken : null,
            currentQuestionIndex: derivedQuestionIds.length ? Math.max(0, Math.min(derivedQuestionIds.length - 1, typeof attempt.answered === 'number' ? attempt.answered - 1 : derivedQuestionIds.length - 1)) : 0,
            questionIds: derivedQuestionIds,
            answers: attempt.answers || {},
            results: attempt.results || {},
            locked: Object.keys(attempt.answers || {}).reduce(function(acc, qid) { acc[qid] = true; return acc; }, {}),
            explanationOpen: attempt.explanationOpen || {}
          };
        }).filter((attempt) => attempt.questionIds.length > 0);
        store.contexts[contextKey] = this.sanitizeContextRecord(contextKey, record);
        changed = true;
      }
      localStorage.removeItem(key);
    });

    if (changed) this.savePracticeStore(store);
  },

  // Wrong questions
  getWrongQuestions() { return this._get('wrong_questions') || []; },
  addWrongQuestion(qid) {
    const w = this.getWrongQuestions();
    if (!w.includes(qid)) { w.push(qid); this._set('wrong_questions', w); }
  },
  removeWrongQuestion(qid) {
    let w = this.getWrongQuestions(); w = w.filter(id => id !== qid);
    this._set('wrong_questions', w);
  },

  // Bookmarks
  getBookmarks() { return this._get('bookmarks') || []; },
  addBookmark(qid) {
    const b = this.getBookmarks();
    if (!b.includes(qid)) { b.push(qid); this._set('bookmarks', b); }
  },
  removeBookmark(qid) {
    let b = this.getBookmarks(); b = b.filter(id => id !== qid);
    this._set('bookmarks', b);
  },
  isBookmarked(qid) { return this.getBookmarks().includes(qid); }
};


// ========================================================
// QUESTION BANK - Data access layer
// ========================================================
const QuestionBank = {
  getById(id) { return App._qData().find(q => q.id === id) || null; },
  getByChapters(chapterNums) {
    const chs = Array.isArray(chapterNums) ? chapterNums : [chapterNums];
    return App._qData().filter(q => q.chapters.some(c => chs.includes(c)));
  },
  getByPaper(pid) { return App._qData().filter(q => q.paperId === pid); },
  getByIds(ids) { return App._qData().filter(q => ids.includes(q.id)); },
  getByIdsInOrder(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const idMap = {};
    App._qData().forEach(function(q) { idMap[q.id] = q; });
    return ids.map(function(id) { return idMap[id] || null; }).filter(Boolean);
  },
  search(keyword) {
    const kw = keyword.toLowerCase().trim();
    if (!kw) return [];
    return App._qData().filter(q => {
      if (q.stemText && q.stemText.toLowerCase().includes(kw)) return true;
      if (q.options) {
        for (const v of Object.values(q.options)) { if (v.toLowerCase().includes(kw)) return true; }
      }
      return false;
    });
  },
  getRandom(count, chapterFilter) {
    let pool = chapterFilter && chapterFilter.length > 0
      ? App._qData().filter(q => q.chapters.some(c => chapterFilter.includes(c)))
      : App._qData();
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
};


// ========================================================
// UI RENDERER
// ========================================================
const UIRenderer = {
  escapeAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
  },

  renderContextCardActions(mode, contextValue, summary) {
    const quoted = '\'' + this.escapeAttr(String(contextValue)) + '\'';
    const modeApi = mode === 'paper' ? 'PaperMode' : 'ChapterMode';
    if (summary.state === 'in_progress') {
      return '<div class="btn-group mt-12"><button class="btn btn-primary" onclick="' + modeApi + '.launch(' + quoted + ');event.stopPropagation();">Resume</button></div>';
    }
    if (summary.state === 'completed') {
      return '<div class="btn-group mt-12"><button class="btn btn-primary" onclick="' + modeApi + '.launch(' + quoted + ');event.stopPropagation();">Review</button><button class="btn btn-outline" onclick="' + modeApi + '.restart(' + quoted + ');event.stopPropagation();">Restart</button></div>';
    }
    return '<div class="btn-group mt-12"><button class="btn btn-primary" onclick="' + modeApi + '.launch(' + quoted + ');event.stopPropagation();">Start</button></div>';
  },

  renderContextSummary(mode, contextValue, summary, totalQuestions) {
    if (summary.state === 'in_progress' && summary.activeSession) {
      const progress = summary.activeSession.progress;
      return '<div class="card-subtitle">In Progress</div>' +
        '<div class="card-stats"><span class="card-stat">' + progress.answered + '/' + totalQuestions + ' completed</span><span class="card-stat">' + progress.accuracy + '% accuracy</span></div>' +
        '<div class="card-subtitle">Last saved ' + App.getRelativeTimeLabel(summary.activeSession.lastSavedAt) + '</div>';
    }
    if (summary.state === 'completed' && summary.latestCompleted) {
      const progress = summary.latestCompleted.progress;
      return '<div class="card-subtitle">Completed</div>' +
        '<div class="card-stats"><span class="card-stat">' + progress.answered + '/' + totalQuestions + ' completed</span><span class="card-stat">' + progress.accuracy + '% accuracy</span></div>' +
        '<div class="card-subtitle">Completed ' + App.getRelativeTimeLabel(summary.latestCompleted.completedAt || summary.latestCompleted.lastSavedAt) + '</div>';
    }
    return '<div class="card-subtitle">Not Started</div>' +
      '<div class="card-stats"><span class="card-stat">0/' + totalQuestions + ' completed</span><span class="card-stat">--</span></div>';
  },

  renderHome() {
    const totalCh = Object.keys(App._chapters()).length;
    let practiced = 0, tQ = 0, cQ = 0, inProgress = 0;
    const practiceRecords = Storage.getAllContextRecords();
    Object.keys(practiceRecords).forEach(function(contextKey) {
      const record = practiceRecords[contextKey];
      if (record && record.activeSession) inProgress++;
      const latest = record && record.completedAttempts && record.completedAttempts.length
        ? record.completedAttempts[record.completedAttempts.length - 1]
        : null;
      if (latest && latest.progress) {
        practiced++;
        tQ += latest.progress.answered || 0;
        cQ += latest.progress.correct || 0;
      }
    });
    const oa = tQ > 0 ? Math.round((cQ / tQ) * 100) : 0;
    const wc = Storage.getWrongQuestions().length;

    return '<div class="page-header"><h2>Dashboard</h2><p>Cambridge International A Level Economics &mdash; Paper 1 MCQ Practice</p></div>' +
      '<div class="stats-grid">' +
        '<div class="stat-card"><div class="stat-value">' + tQ + '</div><div class="stat-label">Questions Attempted</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + oa + '%</div><div class="stat-label">Overall Accuracy</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + practiced + '</div><div class="stat-label">Completed Contexts</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + inProgress + '</div><div class="stat-label">Active Sessions</div></div>' +
      '</div>' +
      '<div class="card-grid mt-24">' +
        '<div class="card" onclick="App.navigate(\'chapter-select\')"><div class="card-header"><span class="card-title">📚 Practice by Chapter</span></div><div class="card-subtitle">Study specific topics with chapter-by-chapter tracking</div><div class="progress-bar"><div class="progress-fill" style="width:' + Math.round((Object.keys(Storage.getAllContextRecords('chapter:')).length/Math.max(1,totalCh))*100) + '%"></div></div></div>' +
        '<div class="card" onclick="App.navigate(\'paper-select\')"><div class="card-header"><span class="card-title">📄 Practice by Past Paper</span></div><div class="card-subtitle">Complete full past papers under exam conditions</div></div>' +
        '<div class="card" onclick="App.navigate(\'random-practice\')"><div class="card-header"><span class="card-title">🎲 Random Practice</span></div><div class="card-subtitle">Mixed questions from all chapters to test your knowledge</div></div>' +
      '<div class="card" onclick="App.navigate(\'wrong-book\')"><div class="card-header"><span class="card-title">❌ Wrong Question Review</span></div><div class="card-subtitle">Retry questions you got wrong until you master them</div></div>' +
      '<div class="card" onclick="App.navigate(\'stats\')"><div class="card-header"><span class="card-title">📈 Progress Overview</span></div><div class="card-subtitle">' + wc + ' wrong questions saved for review</div></div>' +
      '</div>';
  },

  renderChapterSelect() {
    let cards = '';
    const sorted = Object.keys(App._chapters()).map(Number).sort((a, b) => a - b);
    for (const ch of sorted) {
      const label = App._chapters()[ch];
      const qc = QuestionBank.getByChapters(ch).length;
      const summary = App.getContextStatus('chapter', { chapter: ch });
      const borderColor = summary.state === 'in_progress' ? 'var(--accent)' : (summary.state === 'completed' ? 'var(--border-correct)' : 'var(--border-light)');
      if (qc === 0) {
        cards += '<div class="card card-disabled" style="border-left:3px solid var(--border-light)">' +
          '<div class="card-header"><span class="card-title">Chapter ' + ch + ': ' + label + '</span></div>' +
          '<div class="card-subtitle">No questions added yet</div>' +
          '</div>';
        continue;
      }
      const answered = summary.state === 'in_progress'
        ? summary.activeSession.progress.answered
        : (summary.state === 'completed' ? summary.latestCompleted.progress.answered : 0);
      const progressPct = Math.round(((answered || 0) / qc) * 100);
      cards += '<div class="card" onclick="ChapterMode.launch(' + ch + ')" style="border-left:3px solid ' + borderColor + '">' +
        '<div class="card-header"><span class="card-title">Chapter ' + ch + ': ' + label + '</span></div>' +
        '<div class="card-subtitle">' + qc + ' questions available</div>' +
        this.renderContextSummary('chapter', ch, summary, qc) +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + (summary.state === 'not_started' ? 0 : progressPct) + '%"></div></div>' +
        this.renderContextCardActions('chapter', ch, summary) +
        '</div>';
    }
    return '<div class="page-header"><h2>Practice by Chapter</h2><p>Select a chapter to begin focused practice</p></div><div class="card-grid">' + cards + '</div>';
  },

  renderPaperSelect() {
    let cards = '';
    const sorted = Object.keys(App._papers()).sort().reverse();
    const snames = { 'SJ': 'Summer (May/Jun)', 'MJ': 'March', 'ON': 'Winter (Oct/Nov)' };
    for (const pid of sorted) {
      const p = App._papers()[pid];
      const summary = App.getContextStatus('paper', { paperId: pid });
      const statusColor = summary.state === 'in_progress' ? 'var(--accent)' : (summary.state === 'completed' ? 'var(--border-correct)' : 'var(--border-light)');
      const progressAnswered = summary.state === 'in_progress'
        ? summary.activeSession.progress.answered
        : (summary.state === 'completed' ? summary.latestCompleted.progress.answered : 0);
      const progressPct = Math.round((progressAnswered / p.questionCount) * 100);
      cards += '<div class="card" onclick="PaperMode.launch(\'' + this.escapeAttr(pid) + '\')" style="border-left: 3px solid ' + statusColor + '">' +
        '<div class="card-header"><span class="card-title">' + p.year + ' ' + (snames[p.session] || p.session) + '</span><span class="chapter-tag">' + p.paper + '</span></div>' +
        this.renderContextSummary('paper', pid, summary, p.questionCount) +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + progressPct + '%"></div></div>' +
        this.renderContextCardActions('paper', pid, summary) +
        '</div>';
    }
    return '<div class="page-header"><h2>Practice by Past Paper</h2><p>Select a past paper to practice</p><button class="btn btn-outline btn-sm mt-8" onclick="PaperMode.startTimedChoice()">⏱ Timed Practice</button></div><div class="card-grid">' + cards + '</div>';
  },

  renderRandomSetup() {
    let cbs = '';
    const sorted = Object.keys(App._chapters()).map(Number).sort((a, b) => a - b);
    for (const ch of sorted) {
      cbs += '<label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;padding:4px 0;cursor:pointer;"><input type="checkbox" value="' + ch + '" class="random-ch-cb" style="accent-color:var(--accent);"> Ch ' + ch + '</label>';
    }
    return '<div class="page-header"><h2>Random Practice Mode</h2><p>Configure your random question session</p></div>' +
      '<div class="card" style="max-width:600px;">' +
      '<div style="margin-bottom:16px;"><label style="display:block;font-weight:600;margin-bottom:6px;">Number of Questions</label><select id="randomCount" class="select-input" style="width:100%;"><option value="5">5 questions</option><option value="10" selected>10 questions</option><option value="20">20 questions</option><option value="30">30 questions</option></select></div>' +
      '<div style="margin-bottom:16px;"><label style="display:block;font-weight:600;margin-bottom:6px;">Filter by Chapters (optional)</label><div style="display:flex;flex-wrap:wrap;gap:8px;max-height:200px;overflow-y:auto;">' + cbs + '</div><button class="btn btn-sm mt-8" onclick="document.querySelectorAll(\'.random-ch-cb\').forEach(cb=>cb.checked=false)">Clear All</button></div>' +
      '<button class="btn btn-primary" onclick="RandomMode.start()">Start Random Practice</button></div>';
  },

  renderPractice() {
    const q = App.getCurrentQuestion();
    if (!q) return '<div class="empty-state"><div class="icon-big">✅</div><h3>Session Complete</h3></div>';

    const isReview = App.sessionViewMode === 'review';
    const isLocked = isReview ? true : (App.sessionLocked[q.id] || false);
    const totalQ = App.sessionQuestions.length;
    const progress = App.calculateSessionProgress(App.sessionQuestions.map(function(item) { return item.id; }), App.sessionAnswers, App.sessionResults);
    const answeredCount = progress.answered;
    const isBookmarked = Storage.isBookmarked(q.id);

    let chapterTags = '';
    if (q.chapters && q.chapters.length > 0) {
      chapterTags = q.chapters.map(c => '<span class="chapter-tag">Ch ' + c + ': ' + (App._chapters()[c] || '') + '</span>').join('');
    }

    let stemHTML = '';
    stemHTML = App.buildQuestionImageMarkup(q);

    let optionsHTML = '';
    for (const letter of ['A', 'B', 'C', 'D']) {
      if (!q.options || !q.options[letter]) continue;
      let cls = '';
      if (isLocked) {
        cls += ' locked';
        if (App.sessionAnswers[q.id]) {
          if (letter === q.answer) cls += ' correct';
          if (letter === App.sessionAnswers[q.id] && !App.sessionResults[q.id]) cls += ' wrong';
        }
      }
      optionsHTML += '<button class="option-btn option-btn-compact' + cls + '" data-option="' + letter + '" ' + (isLocked ? 'disabled' : '') + ' onclick="App.selectAnswer(\'' + letter + '\')" aria-label="Answer ' + letter + '"><span class="option-letter">' + letter + '</span></button>';
    }

    let resultHTML = '';
    if (isLocked && App.sessionAnswers[q.id]) {
      const isCorrect = App.sessionResults[q.id];
      resultHTML = '<div id="answerResult" style="display:block;padding:12px 0;font-size:0.95rem;font-weight:600;text-align:center;">' +
        (isCorrect ? '<span style="color:var(--border-correct);">✔ Correct!</span>' : '<span style="color:var(--border-wrong);">✘ Wrong. Correct answer: <strong>' + q.answer + '</strong></span>') +
        '</div>';
    } else {
      resultHTML = '<div id="answerResult" style="display:none;"></div>';
    }

    let timerHTML = App.timerActive ? '<span class="timer-display" id="timerDisplay">--:--</span>' : '';

    let paletteHTML = '';
    if (totalQ <= 50) {
      let dots = '';
      for (let i = 0; i < totalQ; i++) {
        const qq = App.sessionQuestions[i];
        let dc = 'palette-dot';
        if (i === App.sessionIndex) dc += ' current';
        if (qq && App.sessionLocked[qq.id]) dc += App.sessionResults[qq.id] ? ' answered' : ' wrong-answered';
        dots += '<button class="' + dc + '" onclick="App.jumpToQuestion(' + i + ')" title="Q' + (i+1) + '">' + (i+1) + '</button>';
      }
      paletteHTML = '<hr class="separator"><div class="palette-grid" id="questionPalette">' + dots + '</div>';
    }

    let explanationHTML = isLocked ? App.buildExplanationMarkup(q.id) : '';

    const currentRecord = App.currentContextKey ? Storage.getContextRecord(App.currentContextKey) : null;
    const lastSavedAt = currentRecord && currentRecord.activeSession ? currentRecord.activeSession.lastSavedAt : null;
    const saveMeta = App.sessionViewMode === 'active'
      ? (App.hasUnsavedChanges ? 'Unsaved changes' : 'Last saved ' + App.getRelativeTimeLabel(lastSavedAt))
      : 'Reviewing completed attempt';

    return '<div class="practice-controls"><div><span class="progress-info" id="progressText">Question <strong>' + (App.sessionIndex + 1) + '</strong> of <strong>' + totalQ + '</strong> &middot; ' + answeredCount + ' answered</span><div class="card-subtitle">' + saveMeta + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:12px;"><button class="bookmark-toggle ' + (isBookmarked ? 'active' : '') + '" id="bookmarkBtn" onclick="Bookmarks.toggle(\'' + q.id + '\')">' + (isBookmarked ? '🔖' : '🔖') + '</button>' + timerHTML +
      (App.sessionViewMode === 'active' ? '<button class="btn btn-sm btn-outline" onclick="App.saveAndExit()">💾 Save</button>' : '<button class="btn btn-sm btn-outline" onclick="App.navigate(\'home\')">← Exit Review</button>') + '</div></div>' +
      '<div class="question-card"><div class="question-meta"><span style="font-weight:700;">Q' + q.questionNum + '</span><span style="color:var(--text-muted);">' + q.paperId + '</span>' + chapterTags + '</div>' +
      '<div class="question-stem">' + stemHTML + '</div><div class="options-list answer-choice-grid">' + optionsHTML + '</div>' + resultHTML + explanationHTML + '</div>' +
      '<div class="question-nav">' +
        '<button class="btn" id="btnPrev" onclick="App.prevQuestion()" ' + (App.sessionIndex === 0 ? 'disabled' : '') + '>← Previous</button>' +
        (App.sessionViewMode === 'active'
          ? '<button class="btn btn-outline btn-sm" onclick="App.saveAndExit()">💾 Save</button>'
          : '<button class="btn btn-outline btn-sm" onclick="App.navigate(\'home\')">Exit Review</button>') +
        (App.sessionViewMode === 'active'
          ? (App.sessionIndex >= totalQ - 1
            ? '<button class="btn btn-primary" onclick="App.completeAttempt()">✅ Complete</button>'
            : '<button class="btn btn-primary" id="btnNext" onclick="App.nextQuestion()">Next →</button>')
          : '<button class="btn btn-primary" id="btnNext" onclick="App.nextQuestion()" ' + (App.sessionIndex >= totalQ - 1 ? 'disabled' : '') + '>Next →</button>') +
      '</div>' + paletteHTML;
  },

  renderWrongBook() {
    const wrongIds = Storage.getWrongQuestions();
    if (wrongIds.length === 0) {
      return '<div class="page-header"><h2>Wrong Questions</h2></div><div class="empty-state"><div class="icon-big">🎉</div><h3>No Wrong Questions!</h3><p>Keep practicing — wrong answers will appear here for review.</p></div>';
    }
    let items = '';
    for (const id of wrongIds) {
      const q = QuestionBank.getById(id);
      if (!q) continue;
      const stem = '(Question ' + q.questionNum + ')';
      items += '<div class="wrong-list-item"><div class="info"><div class="q-text">' + stem + '</div><div class="q-meta">' + q.paperId + ' · Q' + q.questionNum + ' · Correct: ' + q.answer + '</div></div><button class="btn btn-sm" onclick="WrongBook.remove(\'' + id + '\')">✅</button></div>';
    }
    return '<div class="page-header flex-between"><div><h2>Wrong Questions</h2><p>' + wrongIds.length + ' questions to retry</p></div><div class="btn-group"><button class="btn btn-primary" onclick="WrongBook.retryAll()">Retry All</button><button class="btn btn-sm" onclick="WrongBook.clearAll()">Clear All</button></div></div>' + items;
  },

  renderBookmarks() {
    const bids = Storage.getBookmarks();
    if (bids.length === 0) {
      return '<div class="page-header"><h2>Bookmarked Questions</h2></div><div class="empty-state"><div class="icon-big">🔖</div><h3>No Bookmarks</h3><p>Click the bookmark icon during practice to save questions.</p></div>';
    }
    let items = '';
    for (const id of bids) {
      const q = QuestionBank.getById(id);
      if (!q) continue;
      const stem = '(Question ' + q.questionNum + ')';
      items += '<div class="wrong-list-item"><div class="info"><div class="q-text">' + stem + '</div><div class="q-meta">' + q.paperId + ' · Q' + q.questionNum + ' · Answer: ' + q.answer + '</div></div><button class="btn btn-sm" onclick="Bookmarks.toggle(\'' + id + '\');App.renderView(\'bookmarks\')">❌</button></div>';
    }
    return '<div class="page-header flex-between"><div><h2>Bookmarked Questions</h2><p>' + bids.length + ' saved questions</p></div><button class="btn btn-primary" onclick="Bookmarks.practiceAll()">Practice All</button></div>' + items;
  },

  renderStats() {
    const cs = Storage.getAllChapterStats();
    const sorted = Object.keys(App._chapters()).map(Number).sort((a, b) => a - b);

    let chapterRows = '';
    let weakest = [];
    for (const ch of sorted) {
      const s = cs[ch] || { answered: 0, correct: 0, total: QuestionBank.getByChapters(ch).length };
      const acc = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : null;
      if (acc !== null && s.answered >= 2) weakest.push({ chapter: ch, accuracy: acc });
      chapterRows += '<div class="chapter-stat-row"><span class="name">Chapter ' + ch + ': ' + App._chapters()[ch] + '</span><span><span style="color:var(--text-secondary);font-size:0.8rem;">' + s.answered + '/' + s.total + '</span><span class="acc" style="margin-left:12px;">' + (acc !== null ? acc + '%' : '--') + '</span></span></div>';
    }

    weakest.sort((a, b) => a.accuracy - b.accuracy);
    const wTop = weakest.slice(0, 3);
    let weakestHTML = '';
    if (wTop.length > 0) {
      weakestHTML = '<div class="page-header mt-24"><h2>Weakest Chapters</h2><p>Focus your study on these areas</p></div>' +
        wTop.map(w => '<div class="chapter-stat-row" style="border-left:3px solid var(--border-wrong);"><span class="name">Chapter ' + w.chapter + ': ' + App._chapters()[w.chapter] + '</span><span class="acc" style="color:var(--border-wrong);">' + w.accuracy + '%</span></div>').join('');
    }

    const ps = Storage.getAllPaperStats();
    const psorted = Object.keys(App._papers()).sort().reverse();
    let paperRows = '';
    for (const pid of psorted) {
      const p = App._papers()[pid];
      const s = ps[pid] || { answered: 0, correct: 0 };
      const acc = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : null;
      paperRows += '<div class="chapter-stat-row"><span class="name">' + p.year + ' ' + p.session + ' ' + p.paper + '</span><span><span style="color:var(--text-secondary);font-size:0.8rem;">' + s.answered + '/' + p.questionCount + '</span><span class="acc" style="margin-left:12px;">' + (acc !== null ? acc + '%' : '--') + '</span></span></div>';
    }

    return '<div class="page-header"><h2>Chapter Statistics</h2><p>Track your progress by chapter</p></div>' + chapterRows +
      weakestHTML +
      '<div class="page-header mt-24"><h2>Paper Statistics</h2><p>Track your past paper performance</p></div>' + paperRows +
      '<div class="mt-24 text-center"><button class="btn btn-sm" onclick="Stats.resetAll()">Reset All Statistics</button></div>';
  },

  renderSearch() {
    return '<div class="page-header"><h2>Search Questions</h2><p>Search by keyword across all question stems and options</p></div><input type="text" class="search-input" id="searchInput" placeholder="e.g., marginal utility, monopoly, inflation..." oninput="Search.perform(this.value)" autofocus><div id="searchResults" class="mt-16"></div>';
  },

  renderSearchResults(results) {
    if (!results || results.length === 0) return '<div class="empty-state"><p>No questions match your search.</p></div>';
    let items = '';
    for (const q of results.slice(0, 50)) {
      const stem = '(Question ' + q.questionNum + ')';
      items += '<div class="wrong-list-item" style="cursor:pointer;" onclick="Search.practiceResults()"><div class="info"><div class="q-text">' + stem + '</div><div class="q-meta">' + q.paperId + ' · Q' + q.questionNum + ' · Answer: ' + q.answer + '</div></div></div>';
    }
    return '<p style="color:var(--text-secondary);font-size:0.85rem;">' + results.length + ' result(s) found</p>' + items;
  },

  renderSettings() {
    return '<div class="page-header"><h2>Settings</h2></div>' +
      '<div class="card" style="max-width:500px;">' +
      '<div class="flex-between" style="margin-bottom:16px;"><span>Dark Mode</span><button class="btn btn-sm ' + (App.darkMode ? 'btn-primary' : '') + '" onclick="App.toggleDarkMode();App.renderView(\'settings\')">' + (App.darkMode ? 'Enabled' : 'Disabled') + '</button></div>' +
      '<hr class="separator"><div class="flex-between"><span>Reset All Data</span><button class="btn btn-sm" style="color:var(--border-wrong);border-color:var(--border-wrong);" onclick="Stats.resetAll();App.showToast(\'All data has been reset.\')">Reset</button></div></div>';
  },

  openLightbox(src) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = '<img src="' + src + '" alt="Enlarged view">';
    overlay.onclick = function() { overlay.remove(); };
    document.body.appendChild(overlay);
    const onKey = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }
};


// ========================================================
// CHAPTER MODE
// ========================================================
const ChapterMode = {
  start: function(chapterNum) {
    const questions = QuestionBank.getByChapters(chapterNum);
    App.startSession(questions, 'chapter', { chapter: chapterNum });
  },
  resume: function(chapterNum) {
    App.resumeSession('chapter', { chapter: chapterNum });
  },
  review: function(chapterNum, attemptId) {
    App.reviewAttempt('chapter', { chapter: chapterNum }, attemptId);
  },
  restart: function(chapterNum) {
    App.restartSession('chapter', { chapter: chapterNum });
  },
  open: function(chapterNum) {
    const summary = App.getContextStatus('chapter', { chapter: chapterNum });
    if (summary.state === 'in_progress') return this.resume(chapterNum);
    if (summary.state === 'completed') return this.review(chapterNum);
    return this.start(chapterNum);
  },
  launch: function(chapterNum) {
    return App.launchQuestions({
      syllabus: App.currentSyllabus,
      mode: 'chapter',
      id: chapterNum
    });
  }
};


// ========================================================
// PAPER MODE
// ========================================================
const PaperMode = {
  start: function(paperId, timed, timerMinutes) {
    const questions = QuestionBank.getByPaper(paperId);
    App.startSession(questions, 'paper', { paperId: paperId, timed: !!timed, timerMinutes: timerMinutes || null });
  },
  resume: function(paperId) {
    App.resumeSession('paper', { paperId: paperId });
  },
  review: function(paperId, attemptId) {
    App.reviewAttempt('paper', { paperId: paperId }, attemptId);
  },
  restart: function(paperId) {
    App.restartSession('paper', { paperId: paperId });
  },
  open: function(paperId) {
    const summary = App.getContextStatus('paper', { paperId: paperId });
    if (summary.state === 'in_progress') return this.resume(paperId);
    if (summary.state === 'completed') return this.review(paperId);
    return this.start(paperId);
  },
  launch: function(paperId) {
    return App.launchQuestions({
      syllabus: App.currentSyllabus,
      mode: 'paper',
      id: paperId
    });
  },
  startTimedChoice: function() {
    const papers = Object.keys(App._papers()).sort().reverse();
    let opts = '';
    for (const pid of papers) {
      const p = App._papers()[pid];
      opts += '<option value="' + pid + '">' + p.year + ' ' + p.session + ' ' + p.paper + '</option>';
    }
    document.getElementById('contentWrapper').innerHTML =
      '<div class="page-header"><h2>Timed Paper Practice</h2><p>Simulate exam conditions with a countdown timer</p></div>' +
      '<div class="card" style="max-width:500px;">' +
      '<div style="margin-bottom:16px;"><label style="display:block;font-weight:600;margin-bottom:6px;">Select Paper</label><select id="timedPaperSelect" class="select-input" style="width:100%;">' + opts + '</select></div>' +
      '<div style="margin-bottom:16px;"><label style="display:block;font-weight:600;margin-bottom:6px;">Time Limit (minutes)</label><select id="timedMinutes" class="select-input" style="width:100%;"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="75" selected>75 minutes (exam standard)</option></select></div>' +
      '<button class="btn btn-primary" onclick="var p=document.getElementById(\'timedPaperSelect\').value;var m=parseInt(document.getElementById(\'timedMinutes\').value);PaperMode.start(p,true,m);">Start Timed Practice</button></div>';
  }
};


// ========================================================
// RANDOM MODE
// ========================================================
const RandomMode = {
  start: function() {
    const ce = document.getElementById('randomCount');
    const count = ce ? parseInt(ce.value) : 10;
    const sc = [];
    document.querySelectorAll('.random-ch-cb:checked').forEach(function(cb) { sc.push(parseInt(cb.value)); });
    const questions = QuestionBank.getRandom(count, sc);
    App.startSession(questions, 'random');
  }
};


// ========================================================
// WRONG BOOK
// ========================================================
const WrongBook = {
  retryAll: function() {
    const wrongIds = Storage.getWrongQuestions();
    const questions = QuestionBank.getByIds(wrongIds);
    if (questions.length === 0) { App.showToast('No wrong questions to retry.'); return; }
    App.startSession(questions, 'wrong');
  },
  remove: function(id) {
    Storage.removeWrongQuestion(id);
    App.updateBadges();
    App.renderView('wrong-book');
    App.showToast('Question removed from wrong list.');
  },
  clearAll: function() {
    if (confirm('Remove all wrong questions? This cannot be undone.')) {
      localStorage.removeItem(Storage._prefix() + 'wrong_questions');
      App.updateBadges();
      App.renderView('wrong-book');
      App.showToast('All wrong questions cleared.');
    }
  }
};


// ========================================================
// STATISTICS
// ========================================================
const Stats = {
  resetAll: function() {
    if (!confirm('This will permanently delete ALL your progress, statistics, wrong questions, and bookmarks. Are you sure?')) return;
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf('econ_mcq_') === 0 || k.indexOf('econ_as_') === 0) keys.push(k);
    }
    keys.forEach(function(k) { localStorage.removeItem(k); });
    App.updateBadges();
    App.renderView('stats');
  }
};


// ========================================================
// BOOKMARKS
// ========================================================
const Bookmarks = {
  toggle: function(questionId) {
    if (Storage.isBookmarked(questionId)) { Storage.removeBookmark(questionId); }
    else { Storage.addBookmark(questionId); }
    App.updateBadges();
    var btn = document.getElementById('bookmarkBtn');
    if (btn) {
      var isB = Storage.isBookmarked(questionId);
      btn.classList.toggle('active', isB);
      btn.innerHTML = isB ? '🔖' : '🔖';
    }
  },
  practiceAll: function() {
    var ids = Storage.getBookmarks();
    var questions = QuestionBank.getByIds(ids);
    if (questions.length === 0) { App.showToast('No bookmarked questions.'); return; }
    App.startSession(questions, 'bookmark');
  }
};


// ========================================================
// SEARCH
// ========================================================
const Search = {
  lastResults: [],
  perform: function(keyword) {
    if (!keyword || keyword.trim().length < 2) {
      document.getElementById('searchResults').innerHTML = '';
      this.lastResults = [];
      return;
    }
    this.lastResults = QuestionBank.search(keyword);
    document.getElementById('searchResults').innerHTML = UIRenderer.renderSearchResults(this.lastResults);
  },
  practiceResults: function() {
    if (this.lastResults.length === 0) { App.showToast('No search results to practice.'); return; }
    App.startSession(this.lastResults, 'search');
  }
};


// ========================================================
// SIDEBAR OVERLAY CLICK (mobile)
// ========================================================
document.addEventListener('DOMContentLoaded', function() {
  var overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.addEventListener('click', function() { App.closeSidebar(); });
});


// ========================================================
// KEYBOARD SHORTCUTS
// ========================================================
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && UpdateNotes.isOpen) {
    UpdateNotes.close();
    return;
  }
  if (App.currentView !== 'practice') return;
  var q = App.getCurrentQuestion();
  if (!q) return;
  var isLocked = App.sessionLocked[q.id];

  switch (e.key.toLowerCase()) {
    case 'a': case 'b': case 'c': case 'd':
      if (!isLocked) App.selectAnswer(e.key.toUpperCase());
      break;
    case 'arrowright': case ' ':
      e.preventDefault(); App.nextQuestion(); break;
    case 'arrowleft':
      e.preventDefault(); App.prevQuestion(); break;
    case 'escape':
      App.navigate('home'); break;
    case 'f':
      if (!e.ctrlKey && !e.metaKey) App.completeAttempt(); break;
  }
});


// ========================================================
// BOOTSTRAP
// ========================================================
(function() {
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    App.init();
  } else {
    document.addEventListener('DOMContentLoaded', function() { App.init(); });
  }
})();
