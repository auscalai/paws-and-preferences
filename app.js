/* ═══════════════════════════════════════════════
   PAWS & PREFERENCES — App Engine
   Created by: Ausca Lai 2026
   Swipe logic · API integration · State machine
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Config ───
  const CONFIG = {
    API_BASE: 'https://cataas.com',
    CAT_COUNT: 15,
    SWIPE_THRESHOLD: 100,        // px to commit swipe
    VELOCITY_THRESHOLD: 0.5,     // px/ms
    ROTATION_FACTOR: 0.12,       // degrees per px
    MAX_ROTATION: 20,            // degrees
    ANIMATION_DURATION: 350,     // ms
    VISIBLE_CARDS: 3,
    LOAD_TIMEOUT: 15000,         // ms
  };

  // ─── App State ───
  let state = {
    cats: [],
    currentIndex: 0,
    phase: 'loading', // loading | swipe | summary | error
    isAnimating: false,
  };

  // ─── DOM Refs ───
  const $ = (id) => document.getElementById(id);
  const screens = {
    loading: $('loading-screen'),
    swipe: $('swipe-screen'),
    summary: $('summary-screen'),
    error: $('error-screen'),
  };
  const els = {
    progressBar: $('progress-bar'),
    progressText: $('progress-text'),
    cardContainer: $('card-container'),
    swipeCounter: $('swipe-counter'),
    swipeHint: $('swipe-hint'),
    btnDislike: $('btn-dislike'),
    btnLike: $('btn-like'),
    likedCount: $('liked-count'),
    dislikedCount: $('disliked-count'),
    likedSection: $('liked-section'),
    noLikesSection: $('no-likes-section'),
    gallery: $('gallery'),
    btnPlayAgain: $('btn-play-again'),
    btnRetry: $('btn-retry'),
    errorMessage: $('error-message'),
  };

  // ─── Drag State ───
  let drag = {
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    currentX: 0,
    card: null,
  };

  // ═══════════ SCREEN MANAGEMENT ═══════════

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    state.phase = name;
  }

  // ═══════════ API & DATA ═══════════

  async function fetchCats() {
    const skip = Math.floor(Math.random() * 500);
    const url = `${CONFIG.API_BASE}/api/cats?limit=${CONFIG.CAT_COUNT}&skip=${skip}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`API responded with ${response.status}`);

    const data = await response.json();
    if (!data || data.length === 0) throw new Error('No cats returned');

    // Filter to only jpeg/png images
    const validCats = data.filter(cat =>
      cat.mimetype && (cat.mimetype.includes('jpeg') || cat.mimetype.includes('png'))
    );

    if (validCats.length === 0) throw new Error('No valid cat images found');

    return validCats.map(cat => ({
      id: cat.id,
      tags: cat.tags || [],
      imageUrl: `${CONFIG.API_BASE}/cat/${cat.id}`,
      liked: null,
    }));
  }

  function preloadImages(cats) {
    let loaded = 0;
    const total = cats.length;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('Image preload timeout — proceeding with loaded images');
        resolve();
      }, CONFIG.LOAD_TIMEOUT);

      cats.forEach((cat) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          loaded++;
          const pct = Math.round((loaded / total) * 100);
          els.progressBar.style.width = `${pct}%`;
          els.progressText.textContent = `${loaded} / ${total}`;

          if (loaded >= total) {
            clearTimeout(timeout);
            resolve();
          }
        };
        img.src = cat.imageUrl;
      });
    });
  }

  // ═══════════ CARD RENDERING ═══════════

  function initializeCards() {
    els.cardContainer.innerHTML = '';

    for (let i = state.cats.length - 1; i >= 0; i--) {
      const cat = state.cats[i];
      const card = createCardElement(cat, i);
      els.cardContainer.appendChild(card);
    }

    updateCards();
  }

  function updateCards() {
    const cards = els.cardContainer.querySelectorAll('.cat-card');

    cards.forEach((card) => {
      const catIndex = parseInt(card.dataset.index);

      if (catIndex < state.currentIndex) return; // Ignore swiped cards

      const stackIndex = catIndex - state.currentIndex;

      if (stackIndex < CONFIG.VISIBLE_CARDS) {
        card.style.visibility = 'visible';
        const scale = 1 - stackIndex * 0.04;
        const translateY = stackIndex * 10;

        // Ensure smooth transition when bubbling up the stack
        card.style.transition = 'transform 0.25s var(--ease-spring), opacity 0.25s ease, visibility 0s';
        card.style.transform = `scale(${scale}) translateY(${translateY}px)`;
        card.style.zIndex = CONFIG.VISIBLE_CARDS - stackIndex;
        card.style.opacity = stackIndex < 2 ? 1 : 0.6;
        card.style.pointerEvents = stackIndex === 0 ? 'auto' : 'none';
      } else {
        card.style.transition = 'none';
        card.style.visibility = 'hidden';
        card.style.opacity = '0';
      }
    });

    updateCounter();
  }

  function createCardElement(cat, catIndex) {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.dataset.catId = cat.id;
    card.dataset.index = catIndex;

    const tags = cat.tags.slice(0, 4);
    const tagsHTML = tags.length > 0
      ? `<div class="card-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    card.innerHTML = `
      <img class="cat-image" src="${cat.imageUrl}" alt="Cat photo${cat.tags.length > 0 ? ' - ' + cat.tags.slice(0, 2).join(', ') : ''}" loading="eager" draggable="false">
      <div class="card-overlay"></div>
      <div class="swipe-indicator like">LIKE</div>
      <div class="swipe-indicator dislike">NOPE</div>
      <div class="card-info">${tagsHTML}</div>
    `;

    if (catIndex === 0) {
      card.style.animation = 'cardEntrance 0.35s var(--ease-spring) forwards';
    } else {
      card.style.visibility = 'hidden';
      card.style.opacity = '0';
    }

    return card;
  }

  function updateCounter() {
    const current = Math.min(state.currentIndex + 1, state.cats.length);
    els.swipeCounter.textContent = `${current} / ${state.cats.length}`;
  }

  // ═══════════ SWIPE ENGINE ═══════════

  function getTopCard() {
    return els.cardContainer.querySelector(`.cat-card[data-index="${state.currentIndex}"]`);
  }

  // Removed manual drag state handlers in favor of Hammer.js logic inside initTouchEvents

  function commitSwipe(card, liked) {
    state.isAnimating = true;
    const direction = liked ? 1 : -1;
    const flyX = direction * (window.innerWidth + 200);
    const rotation = direction * 30;

    card.style.transition = `transform ${CONFIG.ANIMATION_DURATION}ms var(--ease-smooth), opacity ${CONFIG.ANIMATION_DURATION}ms ease`;
    card.style.transform = `translateX(${flyX}px) rotate(${rotation}deg)`;
    card.style.opacity = '0';
    card.style.pointerEvents = 'none';

    // Flash indicator
    const indClass = liked ? '.swipe-indicator.like' : '.swipe-indicator.dislike';
    const indicator = card.querySelector(indClass);
    if (indicator) indicator.style.opacity = 1;

    // Update state
    state.cats[state.currentIndex].liked = liked;
    state.currentIndex++;

    updateCards();

    setTimeout(() => {
      state.isAnimating = false;

      if (state.currentIndex >= state.cats.length) {
        showSummary();
      }
    }, CONFIG.ANIMATION_DURATION);
  }

  function triggerButtonSwipe(liked) {
    if (state.isAnimating || state.phase !== 'swipe') return;

    const card = getTopCard();
    if (!card) return;

    els.swipeHint.classList.add('hidden');

    // Show indicator briefly
    const indClass = liked ? '.swipe-indicator.like' : '.swipe-indicator.dislike';
    const indicator = card.querySelector(indClass);
    if (indicator) indicator.style.opacity = 1;

    // Small slide then commit
    const slideX = liked ? 40 : -40;
    const rotation = liked ? 5 : -5;
    card.style.transition = 'transform 0.15s ease';
    card.style.transform = `translateX(${slideX}px) rotate(${rotation}deg)`;

    setTimeout(() => commitSwipe(card, liked), 100);
  }

  // ─── Touch Events powered by Hammer.js ───
  function initTouchEvents() {
    const container = els.cardContainer;
    const hammer = new Hammer(container);
    hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL, threshold: 2 });

    hammer.on('panstart', (e) => {
      if (state.isAnimating || state.phase !== 'swipe') return;

      const card = getTopCard();
      if (!card) return;

      // Ensure we don't start dragging if we just clicked a button inside container
      if (e.target.closest('.action-btn')) return;

      drag.active = true;
      drag.card = card;

      // Stop transitions and entrance animations so it sticks to finger
      drag.card.style.transition = 'none';
      if (drag.card.style.animation) {
        drag.card.style.animation = 'none';
      }

      els.swipeHint.classList.add('hidden');
    });

    hammer.on('panmove', (e) => {
      if (!drag.active || !drag.card) return;

      const deltaX = e.deltaX;
      const deltaY = e.deltaY;
      drag.currentX = deltaX;

      const rotation = Math.min(Math.max(deltaX * CONFIG.ROTATION_FACTOR, -CONFIG.MAX_ROTATION), CONFIG.MAX_ROTATION);
      drag.card.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;

      // Show indicators
      const likeIndicator = drag.card.querySelector('.swipe-indicator.like');
      const dislikeIndicator = drag.card.querySelector('.swipe-indicator.dislike');
      const progress = Math.min(Math.abs(deltaX) / CONFIG.SWIPE_THRESHOLD, 1);

      if (deltaX > 0) {
        if (likeIndicator) likeIndicator.style.opacity = progress;
        if (dislikeIndicator) dislikeIndicator.style.opacity = 0;

        // Dynamic glow for Like button
        els.btnLike.style.transform = `scale(${1 + progress * 0.15})`;
        els.btnLike.style.borderColor = `rgba(136, 217, 194, ${progress})`;
        els.btnLike.style.boxShadow = `0 0 ${progress * 28}px var(--mint-glow)`;
        els.btnLike.style.background = `rgba(136, 217, 194, ${progress * 0.1})`;
        els.btnDislike.removeAttribute('style');
      } else {
        if (dislikeIndicator) dislikeIndicator.style.opacity = progress;
        if (likeIndicator) likeIndicator.style.opacity = 0;

        // Dynamic glow for Dislike button
        els.btnDislike.style.transform = `scale(${1 + progress * 0.15})`;
        els.btnDislike.style.borderColor = `rgba(255, 111, 97, ${progress})`;
        els.btnDislike.style.boxShadow = `0 0 ${progress * 28}px var(--coral-glow)`;
        els.btnDislike.style.background = `rgba(255, 111, 97, ${progress * 0.1})`;
        els.btnLike.removeAttribute('style');
      }
    });

    hammer.on('panend pancancel', (e) => {
      if (!drag.active || !drag.card) return;

      drag.active = false;
      const deltaX = drag.currentX;
      const velocity = Math.abs(e.velocityX);

      // Hammer provides velocity in px/ms
      const committed = Math.abs(deltaX) > CONFIG.SWIPE_THRESHOLD || velocity > CONFIG.VELOCITY_THRESHOLD;

      // Clean up dynamic button styles
      els.btnLike.removeAttribute('style');
      els.btnDislike.removeAttribute('style');

      if (committed && deltaX !== 0) {
        const liked = deltaX > 0;
        commitSwipe(drag.card, liked);
      } else {
        // Spring back
        drag.card.style.transition = `transform 0.3s var(--ease-spring)`;
        drag.card.style.transform = `translate(0px, 0px) rotate(0deg)`;

        const likeInd = drag.card.querySelector('.swipe-indicator.like');
        const dislikeInd = drag.card.querySelector('.swipe-indicator.dislike');
        if (likeInd) likeInd.style.opacity = 0;
        if (dislikeInd) dislikeInd.style.opacity = 0;
      }

      drag.card = null;
    });
  }

  // ─── Keyboard Support ───
  function initKeyboardEvents() {
    document.addEventListener('keydown', (e) => {
      if (state.phase !== 'swipe') return;

      if (e.key === 'ArrowLeft' || e.key === 'a') {
        triggerButtonSwipe(false);
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        triggerButtonSwipe(true);
      }
    });
  }

  // ═══════════ SUMMARY ═══════════

  function showSummary() {
    const likedCats = state.cats.filter(c => c.liked === true);
    const dislikedCats = state.cats.filter(c => c.liked === false);

    els.likedCount.textContent = likedCats.length;
    els.dislikedCount.textContent = dislikedCats.length;

    if (likedCats.length > 0) {
      els.likedSection.classList.remove('hidden');
      els.noLikesSection.classList.add('hidden');

      els.gallery.innerHTML = likedCats.map(cat => `
        <div class="gallery-item" tabindex="0">
          <img src="${cat.imageUrl}" alt="Liked cat${cat.tags.length > 0 ? ' - ' + cat.tags.slice(0, 2).join(', ') : ''}" loading="lazy">
          <svg class="gallery-heart" width="16" height="16" aria-hidden="true"><use href="#icon-heart"/></svg>
        </div>
      `).join('');
    } else {
      els.likedSection.classList.add('hidden');
      els.noLikesSection.classList.remove('hidden');
    }

    showScreen('summary');
  }

  // ═══════════ INIT ═══════════

  async function initApp() {
    showScreen('loading');
    els.progressBar.style.width = '0%';
    els.progressText.textContent = `0 / ${CONFIG.CAT_COUNT}`;

    try {
      state.cats = await fetchCats();
      await preloadImages(state.cats);

      // Reset state
      state.currentIndex = 0;
      state.isAnimating = false;
      state.cats.forEach(c => c.liked = null);

      // Start swiping
      showScreen('swipe');
      els.swipeHint.classList.remove('hidden');
      initializeCards();
    } catch (err) {
      console.error('Init error:', err);
      els.errorMessage.textContent = err.message || 'Could not fetch cats from the server.';
      showScreen('error');
    }
  }

  // ─── Event Bindings ───
  els.btnLike.addEventListener('click', () => triggerButtonSwipe(true));
  els.btnDislike.addEventListener('click', () => triggerButtonSwipe(false));
  els.btnPlayAgain.addEventListener('click', () => initApp());
  els.btnRetry.addEventListener('click', () => initApp());

  initTouchEvents();
  initKeyboardEvents();

  // ─── Helpers ───
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Launch ───
  initApp();

})();
