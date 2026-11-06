/* Presenter controls loaded by the server on eligible HTML pages. */
(function () {
  'use strict';

  const htmlpresent = window.__htmlpresent = window.__htmlpresent || {};
  const presentationEnabled = htmlpresent.present !== false;
  if (!presentationEnabled && !htmlpresent.admin) return;

  const query = new URLSearchParams(location.search);
  const AUDIENCE_PARAM = '__htmlpresent_audience';
  const isAudience = query.get(AUDIENCE_PARAM) === '1';
  const slides = Array.from(document.querySelectorAll('.slide, section[id]'));
  if (!slides.length) return;
  const allowedButton = presentationEnabled && !!(htmlpresent.admin || htmlpresent.role === 'presenter');
  if (slides.length < 2 && !isAudience && !htmlpresent.admin && !allowedButton) return;

  const slug = String(htmlpresent.slug || location.pathname.split('/').filter(Boolean)[0] || 'deck');
  const relPath = String(htmlpresent.path || location.pathname);
  const channelName = `htmlpresent-present:${slug}:${relPath}`;
  const storageKey = `__${channelName}`;
  let current = detectCurrentSlide();
  let audienceWindow = null;
  let audienceConnected = false;   // màn khán giả đã báo "hello" qua kênh đồng bộ
  let audienceWatchTimer = null;
  let audienceLastSeen = 0;        // nhịp tim gần nhất từ màn khán giả
  let audienceHeartbeatTimer = null;
  let audiencePingTimer = null;
  const AUDIENCE_PING_MS = 4000;
  const AUDIENCE_STALE_MS = 11000;
  let channel = null;
  let fabButton = null;
  let fabMenu = null;
  let fabPinButton = null;
  let fabMenuOpen = false;
  let fabHidden = false;
  let fabPinned = false;
  const fabPinnedKey = 'lt-fab-pinned-v1';
  let dragState = null;
  let ignoreFabClick = false;
  const menuItems = [];
  const fabPositionKey = 'lt-fab-pos2';   // đổi key → reset về mặc định góc dưới-phải (bỏ vị trí cũ đã kéo)
  let blackout = false;
  let guard = false;
  let programmaticScroll = false;
  let scrollSettleTimer = null;
  let audienceRoot = null;
  let lastMessage = 0;
  let presenterPanel = null;
  let privateNotes = {};
  let presentationStartedAt = 0;
  let clockTimer = null;

  // --- Điều khiển nâng cao (port từ control bar tự xây của deck) ---
  // Deck "immersive" (landscape/portrait) là bài trình bày thuần → bật reveal
  // từng bước, click-để-tiến, vuốt, ẩn con trỏ, thanh tiến độ. Deck responsive
  // (web cuộn) giữ nguyên hành vi cũ, chỉ thêm các nút điều khiển qua FAB.
  const immersive = String(htmlpresent.layout || 'responsive') !== 'responsive';
  const baseW = Number(htmlpresent.baseWidth) > 0 ? Number(htmlpresent.baseWidth) : 1920;
  const baseH = Number(htmlpresent.baseHeight) > 0 ? Number(htmlpresent.baseHeight) : 1080;
  let shown = 1;                 // số "bước" đang hiện trên slide hiện tại (1 = chỉ nhóm vào slide)
  let stepGroups = [];           // stepGroups[i] = mảng nhóm [data-step] của slide i
  let autoplay = false;
  let autoplayTimer = null;
  const AUTOPLAY_STEP_MS = 2500;
  const AUTOPLAY_SLIDE_MS = 5000;
  const AUTOPLAY_SPEEDS = [1, 1.5, 2, 3];
  let autoplaySpeedIdx = 1;      // mặc định 1.5×
  let overviewEl = null;
  let helpEl = null;
  let progressEl = null;
  let idleTimer = null;
  let goBuffer = '';
  let goBufferTimer = null;
  // Chế độ "hiện cả slide": bật thì mỗi slide hiện hết các bước ngay khi vào,
  // bấm Tiếp là sang slide kế (bỏ qua hiện-từng-bước). Nhớ theo trình duyệt.
  // Chế độ "Hiện cả slide": KHÔNG lưu qua reload — mặc định step từng bước mỗi
  // lần mở (bật tạm trong phiên nếu cần), tránh kẹt làm → nhảy cả slide.
  let revealAllMode = false;

  try { if ('BroadcastChannel' in window) channel = new BroadcastChannel(channelName); } catch (_) {}

  // Deck có bước click thật (slide nào có >1 nhóm) → mới hiện nút chế độ.
  function deckHasSteps() { return stepGroups.some(groups => groups.length > 1); }
  function toggleRevealAll() {
    revealAllMode = !revealAllMode;
    if (revealAllMode) setShown(stepCount(current));
    else updateToolbar();
  }

  // ---------- Reveal từng bước (PowerPoint-style [data-step]) ----------
  // Gom [data-step] theo số bước (value rỗng = bước trước + 1), rồi TÁCH THÀNH
  // từng "click" kiểu deck.js: nhóm đầu hiện khi vào slide; ở các nhóm sau, mỗi
  // "box" (khung chữ/ảnh) là một click riêng, dây nối/mũi tên/tag hiện cùng box
  // kế tiếp. Giữ đúng độ mịn như control bar cũ của deck.
  function buildStepGroups() {
    stepGroups = slides.map(slide => {
      const map = new Map();
      let last = 0;
      slide.querySelectorAll('[data-step]').forEach(el => {
        const raw = String(el.dataset.step == null ? '' : el.dataset.step).trim();
        const n = raw === '' ? last + 1 : Number(raw);
        if (!Number.isFinite(n)) return;
        last = n;
        if (!map.has(n)) map.set(n, []);
        map.get(n).push(el);
      });
      const grouped = [...map.keys()].sort((a, b) => a - b).map(k => map.get(k));
      return toClicks(grouped);
    });
  }

  function isBox(el) {
    return !(el instanceof SVGElement) && !el.matches('.pulse-wrap, .arrow, .tag') &&
      (el.textContent.trim() !== '' || el.querySelector('img') !== null);
  }

  // Tách các nhóm step thành danh sách "click" (mỗi click = mảng phần tử hiện cùng).
  function toClicks(raw) {
    const entry = raw[0] ? raw[0].slice() : [];
    const rest = raw.slice(1);
    const merged = [];
    let carry = [];
    rest.forEach(g => {
      if (!g.some(isBox)) { carry.push(...g); return; } // nhóm không box → gộp vào nhóm kế
      merged.push([...carry, ...g]);
      carry = [];
    });
    if (carry.length) (merged.length ? merged[merged.length - 1] : entry).push(...carry);
    const clicks = [];
    merged.forEach(g => {
      const boxes = g.filter(isBox);
      const parts = boxes.map(b => [b]);
      if (!parts.length) { clicks.push(g); return; }
      const paths = g.filter(el => el instanceof SVGElement);
      const others = g.filter(el => !isBox(el) && !(el instanceof SVGElement));
      if (paths.length === boxes.length) paths.forEach((p, i) => parts[i].unshift(p));
      else parts[0].unshift(...paths);
      others.forEach(el => {
        const i = boxes.findIndex(b => el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        parts[i < 0 ? parts.length - 1 : i].unshift(el);
      });
      clicks.push(...parts);
    });
    return [entry, ...clicks];
  }

  function stepCount(index) {
    const groups = stepGroups[index];
    return groups && groups.length ? groups.length : 1;
  }

  function applyReveal(index, count) {
    const groups = stepGroups[index];
    if (!groups || !groups.length) return;
    groups.forEach((els, gi) => els.forEach(el => el.classList.toggle('in', gi < count)));
  }

  function setShown(n, notify = true) {
    shown = Math.max(1, Math.min(Number(n) || 1, stepCount(current)));
    applyReveal(current, shown);
    updateProgress();
    updateToolbar();
    if (notify) sendState();
    scheduleAutoplay();
  }

  // Với deck landscape/portrait, layout.js bọc mỗi slide trong .htmlpresent-stage
  // và scale slide con (translate -50%). Dò/cuộn phải theo stage (khối full
  // viewport), không theo slide con đã biến đổi. Deck responsive không có stage
  // → trả về chính slide.
  function navEl(slide) {
    const parent = slide && slide.parentElement;
    return parent && parent.classList && parent.classList.contains('htmlpresent-stage') ? parent : slide;
  }

  function detectCurrentSlide() {
    // Read config directly: this function also runs before `immersive` is initialized.
    const horizontal = htmlpresent.present !== false && ['landscape', 'portrait'].includes(htmlpresent.layout);
    const center = horizontal ? innerWidth / 2 : innerHeight / 2;
    let winner = 0, distance = Infinity;
    slides.forEach((slide, i) => {
      const r = navEl(slide).getBoundingClientRect();
      const start = horizontal ? r.left : r.top, end = horizontal ? r.right : r.bottom;
      const d = center < start ? start - center : center > end ? center - end : 0;
      if (d < distance) { distance = d; winner = i; }
    });
    return winner;
  }

  function slideName(slide, i) {
    return slide.id || slide.dataset.slide || String(i + 1);
  }

  function state() {
    return { type: 'state', index: current, shown, total: slides.length, id: slideName(slides[current], current), blackout, at: Date.now() };
  }

  function sendState() {
    const message = state();
    if (isAudience) message.source = 'audience';
    try { if (channel) channel.postMessage(message); } catch (_) {}
    try { localStorage.setItem(storageKey, JSON.stringify(message)); localStorage.removeItem(storageKey); } catch (_) {}
    updateAudience(message);
  }

  function setBlackout(value) {
    blackout = !!value;
    document.documentElement.classList.toggle('htmlpresent-present-blackout', blackout && !isAudience);
    if (audienceRoot) audienceRoot.classList.toggle('htmlpresent-present-blackout', blackout);
    updateToolbar();
    sendState();
  }

  function goTo(index, notify = true, opts = {}) {
    const leaving = current;
    current = Math.max(0, Math.min(slides.length - 1, Number(index) || 0));
    // Slide rời đi thu gọn các bước để lần sau quay lại chạy lại hiệu ứng.
    if (leaving !== current) applyReveal(leaving, 0);
    shown = (opts.revealAll || revealAllMode) ? stepCount(current) : 1;
    applyReveal(current, shown);
    if (!isAudience && slides[current]) {
      if (immersive && presentationEnabled) {
        slides.forEach((slide, i) => {
          const stage = navEl(slide);
          stage.style.setProperty('--lt-slide-offset', `${(i - current) * 100}%`);
          stage.inert = i !== current;
        });
      } else {
      programmaticScroll = true;
      navEl(slides[current]).scrollIntoView({ behavior: 'smooth', block: 'start' });
      clearTimeout(scrollSettleTimer);
      window.addEventListener('scrollend', settleProgrammaticScroll, { once: true });
      scrollSettleTimer = setTimeout(settleProgrammaticScroll, 1400);
      }
      const id = slideName(slides[current], current);
      if (slides[current].id && location.hash !== `#${encodeURIComponent(id)}`) {
        // Dùng URL tuyệt đối (giữ path + query) — nếu chỉ '#id' thì khi có <base>
        // sẽ phân giải theo base và mất đường dẫn file + token ?k=.
        try { history.replaceState(null, '', `${location.pathname}${location.search}#${encodeURIComponent(id)}`); } catch (_) {}
      }
    }
    if (isAudience) renderAudienceSlide(current);
    if (notify) sendState();
    updateProgress();
    updateToolbar();
    scheduleAutoplay();
  }

  function settleProgrammaticScroll() {
    if (!programmaticScroll) return;
    programmaticScroll = false;
    clearTimeout(scrollSettleTimer);
    const actual = detectCurrentSlide();
    if (actual !== current) { current = actual; updateToolbar(); sendState(); }
  }

  function move(delta) {
    if (isEditing()) return;
    if (delta > 0) {
      if (shown < stepCount(current)) setShown(shown + 1);
      else if (current < slides.length - 1) goTo(current + 1);
    } else if (delta < 0) {
      if (shown > 1) setShown(shown - 1);
      else if (current > 0) goTo(current - 1, true, { revealAll: true });
    }
  }

  function audienceUrl() {
    const url = new URL(location.href);
    url.searchParams.set(AUDIENCE_PARAM, '1');
    if (slides[current].id) url.hash = slides[current].id;
    return url.href;
  }

  /* P1-5: tab này LUÔN là màn hình người trình bày.
     Trước Phase 5, khi popup bị chặn, nhánh fallback `window.open(url, name)`
     có thể điều hướng chính tab đang mở → người trình bày mất sạch điều khiển
     và không có đường quay lại. Nay chỉ mở popup có kích thước (popup có
     features không bao giờ điều hướng chính nó), và kiểm tra kỹ kết quả:
     bị chặn → hiện banner có link để người dùng tự bấm (click là user gesture,
     luôn qua được popup blocker). Tuyệt đối không điều hướng tab gốc. */
  function openAudience() {
    if (isAudience || !allowedButton) return;
    showPresenterPanel();

    if (audienceWindow && !audienceWindow.closed) {
      try { audienceWindow.focus(); } catch (_) {}
      sendState();
      renderPresenterPanel();
      return;
    }

    let opened = null;
    try {
      opened = window.open(audienceUrl(), 'htmlpresent-audience', 'popup,width=1280,height=720');
    } catch (_) { opened = null; }

    // `opened === window` nghĩa là trình duyệt tái sử dụng chính tab này —
    // coi như bị chặn và không chạm vào nó.
    if (!opened || opened === window || opened === window.self) {
      audienceWindow = null;
      audienceConnected = false;
      showAudienceBlockedBanner();
      renderPresenterPanel();
      return;
    }

    audienceWindow = opened;
    clearAudienceBlockedBanner();
    try { audienceWindow.addEventListener('load', () => sendState(), { once: true }); } catch (_) {}
    if (audienceWindow.document && audienceWindow.document.readyState === 'complete') sendState();
    watchAudienceWindow();
    showFab();
    renderPresenterPanel();
  }

  // Theo dõi cửa sổ khán giả bị đóng để panel báo đúng trạng thái (không có
  // sự kiện 'close' cho cửa sổ con nên phải poll nhẹ).
  function watchAudienceWindow() {
    clearInterval(audienceWatchTimer);
    audienceWatchTimer = setInterval(() => {
      if (audienceWindow && audienceWindow.closed) {
        audienceWindow = null;
        audienceConnected = false;
        clearInterval(audienceWatchTimer);
        audienceWatchTimer = null;
        renderPresenterPanel();
      }
    }, 1500);
  }

  function audienceStatusText() {
    if (audienceWindow && !audienceWindow.closed) return audienceConnected ? 'Đã kết nối' : 'Đang mở…';
    return audienceConnected ? 'Đã kết nối (cửa sổ khác)' : 'Chưa mở';
  }

  function showAudienceBlockedBanner() {
    if (!presenterPanel) return;
    let banner = presenterPanel.querySelector('.htmlpresent-audience-blocked');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'htmlpresent-audience-blocked';
      banner.innerHTML = `
        <strong>⚠ Trình duyệt chặn cửa sổ khán giả.</strong>
        Màn hình người trình bày vẫn ở nguyên đây.
        <a href="#" target="htmlpresent-audience" rel="opener" class="htmlpresent-audience-blocked-link">Bấm vào đây để mở màn khán giả ↗</a>
        — hoặc cho phép pop-up cho trang này rồi thử lại.`;
      presenterPanel.insertBefore(banner, presenterPanel.firstChild);
      // Link do người dùng bấm → user gesture, không bị popup blocker chặn.
      banner.querySelector('a').addEventListener('click', () => {
        setTimeout(() => { clearAudienceBlockedBanner(); sendState(); }, 400);
      });
    }
    banner.querySelector('a').href = audienceUrl();
  }

  function clearAudienceBlockedBanner() {
    const banner = presenterPanel && presenterPanel.querySelector('.htmlpresent-audience-blocked');
    if (banner) banner.remove();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)?.call(document.documentElement)?.catch?.(() => {});
  }

  function receive(message) {
    if (!message) return;
    // Bắt tay: màn khán giả báo đã mở / đã đóng để panel hiện đúng trạng thái,
    // kể cả khi nó được mở bằng link tay (không có window reference).
    if (message.type === 'hello' && !isAudience) {
      const wasConnected = audienceConnected;
      audienceConnected = true;
      audienceLastSeen = Date.now();
      startAudienceHeartbeatCheck();
      clearAudienceBlockedBanner();
      renderPresenterPanel();
      // Chỉ đẩy state khi màn khán giả vừa kết nối, không phải mỗi nhịp tim.
      if (!wasConnected) sendState();
      return;
    }
    if (message.type === 'bye' && !isAudience) {
      audienceConnected = false;
      audienceLastSeen = 0;
      renderPresenterPanel();
      return;
    }
    if (message.type !== 'state' || !Number.isFinite(Number(message.index))) return;
    if (Number(message.at || 0) <= lastMessage) return;
    lastMessage = Number(message.at || 0);
    if (isAudience) {
      guard = true;
      current = Math.max(0, Math.min(slides.length - 1, Number(message.index)));
      shown = Math.max(1, Math.min(Number(message.shown) || 1, stepCount(current)));
      applyReveal(current, shown);
      blackout = !!message.blackout;
      renderAudienceSlide(current);
      updateToolbar();
      guard = false;
    } else if (message.source === 'audience') {
      goTo(message.index, false);
      setShown(Number(message.shown) || 1, false);
      setBlackout(!!message.blackout);
    }
  }

  function onStorage(event) {
    if (event.key !== storageKey || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch (_) {}
  }

  function setupAudience() {
    // Set this before the server-injected deferred tracker runs.
    htmlpresent.noTrack = true;
    document.documentElement.classList.add('htmlpresent-audience-page');
    audienceRoot = document.createElement('div');
    audienceRoot.id = 'htmlpresent-audience';
    audienceRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(audienceRoot);
    renderAudienceSlide(current);
    // Báo cho người trình bày biết màn khán giả đã sẵn sàng, rồi giữ nhịp tim.
    // `bye` là đường nhanh; nhịp tim mới là thứ đáng tin khi tab bị đóng đột
    // ngột, trình duyệt crash hoặc pagehide không kịp chạy.
    broadcast({ type: 'hello', at: Date.now() });
    audiencePingTimer = setInterval(() => broadcast({ type: 'hello', at: Date.now() }), AUDIENCE_PING_MS);
    window.addEventListener('pagehide', () => {
      clearInterval(audiencePingTimer);
      broadcast({ type: 'bye', at: Date.now() });
    });
  }

  /** Người trình bày: coi màn khán giả là đã đóng nếu quá AUDIENCE_STALE_MS
   *  không nhận được nhịp tim nào. */
  function startAudienceHeartbeatCheck() {
    if (audienceHeartbeatTimer) return;
    audienceHeartbeatTimer = setInterval(() => {
      if (!audienceConnected) return;
      if (Date.now() - audienceLastSeen <= AUDIENCE_STALE_MS) return;
      audienceConnected = false;
      audienceLastSeen = 0;
      renderPresenterPanel();
    }, 3000);
  }

  function broadcast(message) {
    try { if (channel) channel.postMessage(message); } catch (_) {}
    try { localStorage.setItem(storageKey, JSON.stringify(message)); localStorage.removeItem(storageKey); } catch (_) {}
  }

  function renderAudienceSlide(index) {
    if (!audienceRoot) return;
    const slide = slides[index];
    if (!slide) return;
    const clone = slide.cloneNode(true);
    prepareVisibleClone(clone);
    clone.querySelectorAll('aside.notes, .notes, [data-note]').forEach(node => {
      if (node.matches('[data-note]')) node.removeAttribute('data-note');
      else node.remove();
    });
    audienceRoot.replaceChildren(clone);
    audienceRoot.classList.toggle('htmlpresent-present-blackout', blackout);
    // Đồng bộ nền: lấy từ slide → body → html. Nếu đều trong suốt thì để trống,
    // audience sẽ "nhìn xuyên" xuống body gốc (giữ nguyên theme sáng/tối).
    syncAudienceBg(slide);
    requestAnimationFrame(() => fitAudienceSlide(clone));
  }

  function syncAudienceBg(slide) {
    const bg = pickSlideBackground(slide);
    if (bg) document.documentElement.style.setProperty('--htmlpresent-audience-bg', bg);
    else document.documentElement.style.removeProperty('--htmlpresent-audience-bg');
  }

  function fitAudienceSlide(slide) {
    if (!audienceRoot || !slide) return;
    slide.classList.remove('htmlpresent-stage-inner');
    slide.style.transform = 'none';
    slide.style.transformOrigin = 'top left';
    const rect = slide.getBoundingClientRect();
    const width = immersive ? baseW : Math.max(1, rect.width || slide.scrollWidth || innerWidth);
    const height = immersive ? baseH : Math.max(1, rect.height || slide.scrollHeight || innerHeight);
    const scale = Math.min(innerWidth / width, innerHeight / height);
    const scaledW = width * scale, scaledH = height * scale;
    slide.style.position = 'absolute';
    slide.style.left = `${Math.max(0, (innerWidth - scaledW) / 2)}px`;
    slide.style.top = `${Math.max(0, (innerHeight - scaledH) / 2)}px`;
    slide.style.width = `${width}px`;
    slide.style.height = `${height}px`;
    slide.style.minHeight = '0';
    slide.style.overflow = 'hidden';
    slide.style.transform = `scale(${scale})`;
  }

  function readSafeInset(name) {
    const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  }

  function fabBounds() {
    const width = fabButton ? fabButton.offsetWidth || 52 : 52;
    const height = fabButton ? fabButton.offsetHeight || 52 : 52;
    const inset = {
      top: 10 + readSafeInset('--lt-fab-safe-top'),
      right: 10 + readSafeInset('--lt-fab-safe-right'),
      bottom: 10 + readSafeInset('--lt-fab-safe-bottom'),
      left: 10 + readSafeInset('--lt-fab-safe-left')
    };
    return {
      width, height, inset,
      minX: inset.left,
      maxX: Math.max(inset.left, innerWidth - width - inset.right),
      minY: inset.top,
      maxY: Math.max(inset.top, innerHeight - height - inset.bottom)
    };
  }

  function placeFab(left, top) {
    if (!fabButton) return;
    const bounds = fabBounds();
    fabButton.style.left = `${Math.max(bounds.minX, Math.min(bounds.maxX, left))}px`;
    fabButton.style.top = `${Math.max(bounds.minY, Math.min(bounds.maxY, top))}px`;
    fabButton.style.right = 'auto';
    fabButton.style.bottom = 'auto';
    if (fabMenuOpen) positionMenu();
  }

  function nearestFabCorner(left, top) {
    const bounds = fabBounds();
    const corners = [
      { left: bounds.minX, top: bounds.minY },
      { left: bounds.maxX, top: bounds.minY },
      { left: bounds.minX, top: bounds.maxY },
      { left: bounds.maxX, top: bounds.maxY }
    ];
    corners.forEach(corner => { corner.distance = Math.hypot(left - corner.left, top - corner.top); });
    corners.sort((a, b) => a.distance - b.distance);
    return corners[0];
  }

  function snapFabToNearestCorner() {
    if (!fabButton) return;
    const rect = fabButton.getBoundingClientRect();
    const corner = nearestFabCorner(rect.left, rect.top);
    placeFab(corner.left, corner.top);
  }

  function saveFabPosition() {
    if (!fabButton) return;
    const rect = fabButton.getBoundingClientRect();
    try { localStorage.setItem(fabPositionKey, JSON.stringify({ x: rect.left, y: rect.top })); } catch (_) {}
  }

  function restoreFabPosition() {
    if (!fabButton) return;
    try {
      const saved = JSON.parse(localStorage.getItem(fabPositionKey) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        placeFab(saved.x, saved.y);
        snapFabToNearestCorner();
      }
    } catch (_) {}
  }

  function resolveItemValue(value, fallback = '') {
    try { return typeof value === 'function' ? value() : (value == null ? fallback : value); }
    catch (_) { return fallback; }
  }

  function itemIsVisible(item) {
    try { return typeof item.when !== 'function' || !!item.when(); }
    catch (_) { return false; }
  }

  function itemIsDisabled(item) {
    return !!resolveItemValue(item.disabled, false);
  }

  function registerMenuItem(item) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) return () => {};
    const normalized = { ...item, id: item.id.trim() };
    const existing = menuItems.findIndex(candidate => candidate.id === normalized.id);
    if (existing >= 0) menuItems.splice(existing, 1, normalized);
    else menuItems.push(normalized);
    if (fabMenuOpen) renderMenuItems();
    return () => {
      const index = menuItems.indexOf(normalized);
      if (index >= 0) menuItems.splice(index, 1);
      if (fabMenuOpen) renderMenuItems();
    };
  }

  function renderMenuItems() {
    if (!fabMenu) return;
    fabMenu.replaceChildren();
    const visibleItems = menuItems
      .filter(itemIsVisible)
      .sort((a, b) => (Number(a.order) || 100) - (Number(b.order) || 100));
    if (!visibleItems.length) {
      const empty = document.createElement('div');
      empty.className = 'lt-fab-empty';
      empty.textContent = 'Chưa có điều khiển khả dụng.';
      fabMenu.appendChild(empty);
      return;
    }

    for (const item of visibleItems) {
      const label = String(resolveItemValue(item.label, item.id));
      const icon = String(resolveItemValue(item.icon, ''));
      const element = typeof item.onClick === 'function'
        ? document.createElement('button')
        : document.createElement('div');
      element.className = 'lt-fab-item';
      if (typeof item.onClick === 'function') {
        element.type = 'button';
        element.disabled = itemIsDisabled(item);
        element.addEventListener('click', async () => {
          if (element.disabled) return;
          if (!fabPinned) closeMenu();
          try { await item.onClick(); }
          catch (error) { showToast(error && error.message ? error.message : 'Không thực hiện được thao tác.'); }
        });
      } else {
        element.classList.add('lt-fab-item-status');
        element.setAttribute('role', 'status');
      }
      const glyph = document.createElement('span');
      glyph.className = 'lt-fab-item-icon';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = icon;
      const text = document.createElement('span');
      text.className = 'lt-fab-item-label';
      text.textContent = label;
      element.append(glyph, text);
      fabMenu.appendChild(element);
    }
    if (fabPinButton) {
      fabMenu.appendChild(fabPinButton);
      fabPinButton.setAttribute('aria-pressed', fabPinned ? 'true' : 'false');
      fabPinButton.title = fabPinned ? 'Bỏ ghim điều khiển' : 'Ghim điều khiển';
      fabPinButton.innerHTML = `<span class="lt-fab-item-icon" aria-hidden="true">📌</span><span class="lt-fab-item-label">${fabPinned ? 'Bỏ ghim' : 'Ghim'}</span>`;
    }
  }

  function positionMenu() {
    if (!fabButton || !fabMenu || fabMenu.hidden) return;
    // Thanh điều khiển cố định ở DƯỚI-GIỮA màn hình (không bám theo nút FAB).
    const menu = fabMenu.getBoundingClientRect();
    const margin = 12;
    const left = Math.max(margin, Math.round((innerWidth - menu.width) / 2));
    fabMenu.style.left = `${left}px`;
    fabMenu.style.top = 'auto';
    fabMenu.style.bottom = `${16 + readSafeInset('--lt-fab-safe-bottom')}px`;
  }

  function openMenu() {
    if (!fabButton || !fabMenu || fabHidden || isAudience) return;
    renderMenuItems();
    fabMenu.hidden = false;
    fabMenuOpen = true;
    fabButton.setAttribute('aria-expanded', 'true');
    positionMenu();
  }

  function closeMenu() {
    fabMenuOpen = false;
    if (fabMenu) fabMenu.hidden = true;
    if (fabButton) fabButton.setAttribute('aria-expanded', 'false');
  }

  function hideFab() {
    fabHidden = true;
    closeMenu();
    if (fabButton) fabButton.hidden = true;
  }

  function showFab() {
    fabHidden = false;
    if (fabButton && !isAudience) fabButton.hidden = false;
  }

  function openAudienceMenuItem() {
    if (allowedButton) openAudience();
  }

  function togglePresenterPanel() {
    if (presenterPanel) closePresenterPanel();
    else showPresenterPanel();
  }

  // ---------- Tự chạy (autoplay) + tốc độ ----------
  function scheduleAutoplay() {
    clearTimeout(autoplayTimer);
    if (!autoplay || isAudience || isEditing()) return;
    const atSlideEnd = shown >= stepCount(current);
    if (atSlideEnd && current >= slides.length - 1) { setAutoplay(false); return; }
    const base = atSlideEnd ? AUTOPLAY_SLIDE_MS : AUTOPLAY_STEP_MS;
    autoplayTimer = setTimeout(() => move(1), base / AUTOPLAY_SPEEDS[autoplaySpeedIdx]);
  }

  function setAutoplay(on) {
    autoplay = typeof on === 'boolean' ? on : !autoplay;
    if (autoplay) scheduleAutoplay(); else clearTimeout(autoplayTimer);
    updateToolbar();
  }

  function cycleSpeed(dir) {
    autoplaySpeedIdx = (autoplaySpeedIdx + dir + AUTOPLAY_SPEEDS.length) % AUTOPLAY_SPEEDS.length;
    if (autoplay) scheduleAutoplay();
    updateToolbar();
  }

  // ---------- Thanh tiến độ (chỉ deck immersive) ----------
  function setupProgress() {
    if (!immersive || isAudience) return;
    progressEl = document.createElement('div');
    progressEl.className = 'lt-progress';
    progressEl.innerHTML = '<i></i>';
    document.body.appendChild(progressEl);
    updateProgress();
  }

  function updateProgress() {
    if (!progressEl) return;
    const steps = stepCount(current) - 1;
    const within = steps > 0 ? (shown - 1) / steps : 1;
    const pct = ((current + within) / Math.max(1, slides.length)) * 100;
    const bar = progressEl.firstChild;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ---------- Tổng quan (overview grid) ----------
  function openOverview() {
    if (isAudience) return;
    if (!overviewEl) {
      overviewEl = document.createElement('div');
      overviewEl.className = 'lt-overview';
      overviewEl.setAttribute('aria-label', 'Tổng quan slide');
      slides.forEach((slide, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lt-ov-item';
        button.setAttribute('aria-label', `Slide ${i + 1}`);
        const thumb = document.createElement('div');
        thumb.className = 'lt-ov-thumb';
        const clone = slide.cloneNode(true);
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        clone.classList.remove('htmlpresent-stage-inner');
        clone.style.transform = 'none';
        clearCloneNotes(clone);
        clone.querySelectorAll('[data-step]').forEach(node => node.classList.add('in'));
        thumb.appendChild(clone);
        const num = document.createElement('span');
        num.className = 'lt-ov-num';
        num.textContent = i + 1;
        button.append(thumb, num);
        button.addEventListener('click', () => { closeOverview(); goTo(i, true, { revealAll: true }); });
        overviewEl.appendChild(button);
      });
      document.body.appendChild(overviewEl);
    }
    overviewEl.classList.add('is-open');
    requestAnimationFrame(() => {
      overviewEl.querySelectorAll('.lt-ov-item').forEach((button, i) => {
        const source = slides[i];
        if (!source) return;
        const rect = source.getBoundingClientRect();
        const thumb = button.querySelector('.lt-ov-thumb');
        const inner = thumb.firstElementChild;
        const box = thumb.getBoundingClientRect();
        const width = immersive ? baseW : Math.max(1, rect.width || innerWidth);
        const height = immersive ? baseH : Math.max(1, rect.height || innerHeight);
        const scale = Math.min(box.width / width, box.height / height);
        inner.style.position = 'absolute';
        inner.style.left = '0';
        inner.style.top = '0';
        inner.style.width = `${width}px`;
        inner.style.height = `${height}px`;
        inner.style.margin = '0';
        inner.style.transformOrigin = 'top left';
        inner.style.transform = `scale(${scale})`;
        button.classList.toggle('is-current', i === current);
      });
      const cur = overviewEl.querySelector('.lt-ov-item.is-current');
      if (cur) { try { cur.focus({ preventScroll: true }); } catch (_) { cur.focus(); } cur.scrollIntoView({ block: 'nearest' }); }
    });
  }

  function closeOverview() { if (overviewEl) overviewEl.classList.remove('is-open'); }
  function overviewOpen() { return !!(overviewEl && overviewEl.classList.contains('is-open')); }
  function toggleOverview() { overviewOpen() ? closeOverview() : openOverview(); }

  // ---------- Trợ giúp phím tắt ----------
  function toggleHelp() {
    if (!helpEl) {
      helpEl = document.createElement('div');
      helpEl.className = 'lt-help';
      helpEl.innerHTML = `<div class="lt-help-card" role="dialog" aria-label="Hướng dẫn điều khiển">
        <h3>Hướng dẫn điều khiển</h3>
        <p>Di chuột xuống góc phải để mở thanh điều khiển. Bấm nền slide để chuyển tiếp.</p>
        <dl>
          <dt>← / → · Space</dt><dd>Lùi / tiến; hiện từng bước nếu slide có hiệu ứng.</dd>
          <dt>↑ / ↓</dt><dd>Chuyển nguyên slide và hiện hết bước.</dd>
          <dt>Home / End</dt><dd>Về slide đầu / cuối.</dd>
          <dt>Số → Enter</dt><dd>Nhảy thẳng tới slide theo số.</dd>
          <dt>Nút số slide</dt><dd>Mở tổng quan để chọn nhanh slide.</dd>
          <dt>Màn đen</dt><dd>Che slide tạm thời; bấm lại hoặc Esc để trở lại.</dd>
          <dt>Hiện tất cả bước</dt><dd>Bỏ qua hiệu ứng và hiện toàn bộ nội dung slide.</dd>
          <dt>Tự chạy</dt><dd>Tự chuyển slide theo thời gian đã chọn.</dd>
          <dt>Tốc độ</dt><dd>Đổi tốc độ tự chạy.</dd>
          <dt>Toàn màn hình</dt><dd>Bật / tắt toàn màn hình trình duyệt.</dd>
          <dt>📌 Ghim / Bỏ ghim</dt><dd>Giữ thanh điều khiển luôn mở hoặc cho phép tự thu.</dd>
          <dt>Sửa slide</dt><dd>Bật sửa trực tiếp nội dung chữ trên slide.</dd>
          <dt>Trình chiếu</dt><dd>Mở màn hình khán giả và đồng bộ slide.</dd>
          <dt>Chỉ màn người trình bày</dt><dd>Mở ghi chú, đồng hồ và slide kế tiếp.</dd>
          ${allowedButton ? '<dt>V</dt><dd>Màn người trình bày</dd>' : ''}
          <dt>? / H</dt><dd>Mở / đóng hướng dẫn này</dd>
          <dt>Esc</dt><dd>Tắt màn đen; nếu không thì đóng bảng đang mở</dd>
        </dl>
        <button type="button" class="lt-help-close">Đóng</button>
      </div>`;
      helpEl.addEventListener('click', event => {
        if (event.target === helpEl || event.target.closest('.lt-help-close')) closeHelp();
      });
      document.body.appendChild(helpEl);
    }
    helpEl.classList.toggle('is-open');
  }
  function closeHelp() { if (helpEl) helpEl.classList.remove('is-open'); }
  function helpOpen() { return !!(helpEl && helpEl.classList.contains('is-open')); }

  // ---------- Click-để-tiến + vuốt + ẩn con trỏ (chỉ deck immersive) ----------
  function insideControls(target) {
    return !!(target && (
      (fabButton && fabButton.contains(target)) ||
      (fabMenu && fabMenu.contains(target)) ||
      (overviewEl && overviewEl.contains(target)) ||
      (helpEl && helpEl.contains(target)) ||
      (presenterPanel && presenterPanel.contains(target))
    ));
  }

  function setupImmersiveInput() {
    if (!immersive || isAudience) return;
    document.addEventListener('click', event => {
      if ((fabMenuOpen && !fabPinned) || overviewOpen() || helpOpen() || blackout || isEditing()) return;
      if (insideControls(event.target)) return;
      if (event.target.closest && event.target.closest('a,button,input,textarea,select,label,summary,[data-no-advance]')) return;
      move(1);
    });
    let touchX = null, touchY = null;
    document.addEventListener('touchstart', event => {
      touchX = event.touches[0].clientX; touchY = event.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', event => {
      if (touchX === null || isEditing()) { touchX = touchY = null; return; }
      const dx = event.changedTouches[0].clientX - touchX;
      const dy = event.changedTouches[0].clientY - touchY;
      touchX = touchY = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
    }, { passive: true });
    const onMove = () => {
      document.documentElement.classList.remove('lt-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.documentElement.classList.add('lt-idle'), 2500);
    };
    document.addEventListener('mousemove', onMove);
    onMove();
  }

  function setupFab() {
    if (isAudience) return;
    try { fabPinned = localStorage.getItem(fabPinnedKey) === '1'; } catch (_) {}
    registerMenuItem({ id: 'present-prev', label: 'Slide trước', icon: '◀', order: 10,
      when: () => presentationEnabled, disabled: () => current <= 0, onClick: () => move(-1) });
    registerMenuItem({ id: 'present-count', label: () => `Slide ${current + 1}/${slides.length}`, icon: '•', order: 15,
      when: () => presentationEnabled, onClick: toggleOverview });
    registerMenuItem({ id: 'present-next', label: 'Slide tiếp', icon: '▶', order: 20,
      when: () => presentationEnabled, disabled: () => current >= slides.length - 1, onClick: () => move(1) });
    registerMenuItem({ id: 'present-black', label: () => blackout ? 'Mở màn hình' : 'Màn đen', icon: '◼', order: 30,
      when: () => presentationEnabled, onClick: () => setBlackout(!blackout) });
    registerMenuItem({ id: 'present-autoplay', label: () => autoplay ? 'Dừng tự chạy' : 'Tự chạy', icon: () => autoplay ? '⏸' : '▶', order: 34,
      when: () => presentationEnabled && slides.length > 1, onClick: () => setAutoplay() });
    registerMenuItem({ id: 'present-speed', label: () => `Tốc độ ${AUTOPLAY_SPEEDS[autoplaySpeedIdx]}×`, icon: '⏩', order: 36,
      when: () => presentationEnabled && slides.length > 1, onClick: () => cycleSpeed(1) });
    registerMenuItem({ id: 'present-revealmode', label: () => revealAllMode ? 'Hiện tất cả bước ✓' : 'Hiện tất cả bước', icon: '⤢', order: 39,
      when: () => presentationEnabled && deckHasSteps(), onClick: toggleRevealAll });
    registerMenuItem({ id: 'present-fullscreen', label: 'Toàn màn hình', icon: '⛶', order: 40,
      when: () => presentationEnabled, onClick: toggleFullscreen });
    registerMenuItem({ id: 'present-help', label: 'Hướng dẫn', icon: '?', order: 60,
      when: () => presentationEnabled, onClick: toggleHelp });
    // Chế độ 1 màn hình: panel người trình bày (slide hiện tại + slide kế +
    // đồng hồ + ghi chú) ngay trong tab này, không cần cửa sổ thứ hai.
    // "Trình chiếu": 1 click = mở màn người trình bày + màn khán giả cùng lúc.
    registerMenuItem({ id: 'present-start', label: () => (audienceWindow && !audienceWindow.closed) ? 'Trình chiếu ✓' : 'Trình chiếu',
      icon: '🖥', order: 42, when: () => allowedButton, onClick: () => { if (allowedButton) openAudience(); } });
    // Chế độ 1 màn hình: chỉ panel người trình bày (không mở cửa sổ khán giả).
    registerMenuItem({ id: 'present-panel', label: () => presenterPanel ? 'Đóng màn trình bày' : 'Chỉ màn người trình bày',
      icon: '▣', order: 45, when: () => allowedButton, onClick: togglePresenterPanel });
    fabButton = document.createElement('button');
    fabButton.type = 'button';
    fabButton.className = 'lt-fab';
    fabButton.textContent = '⋮';
    fabButton.setAttribute('aria-label', 'Thanh điều khiển');
    fabButton.dataset.tooltip = 'Thanh điều khiển';
    fabButton.setAttribute('aria-controls', 'lt-fab-menu');
    fabButton.setAttribute('aria-expanded', 'false');
    fabMenu = document.createElement('div');
    fabMenu.id = 'lt-fab-menu';
    fabMenu.className = 'lt-fab-menu';
    fabMenu.setAttribute('role', 'group');
    fabMenu.setAttribute('aria-label', 'Điều khiển trình chiếu');
    fabMenu.hidden = true;
    fabPinButton = document.createElement('button');
    fabPinButton.type = 'button';
    fabPinButton.className = 'lt-fab-item lt-fab-pin';
    fabPinButton.setAttribute('aria-label', 'Ghim điều khiển');
    fabPinButton.addEventListener('click', event => {
      event.stopPropagation();
      fabPinned = !fabPinned;
      try { localStorage.setItem(fabPinnedKey, fabPinned ? '1' : '0'); } catch (_) {}
      if (fabPinned && !fabMenuOpen) openMenu();
      else updateToolbar();
    });
    document.body.append(fabButton, fabMenu);
    restoreFabPosition();

    fabButton.addEventListener('click', event => {
      if (ignoreFabClick) { ignoreFabClick = false; event.preventDefault(); return; }
      if (fabMenuOpen) closeMenu(); else openMenu();
    });
    fabButton.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = fabButton.getBoundingClientRect();
      dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        left: rect.left, top: rect.top, dragging: false };
      try { fabButton.setPointerCapture(event.pointerId); } catch (_) {}
    });
    fabButton.addEventListener('pointermove', event => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (!dragState.dragging && Math.hypot(dx, dy) > 6) {
        dragState.dragging = true;
        fabButton.classList.add('is-dragging');
        closeMenu();
      }
      if (dragState.dragging) {
        event.preventDefault();
        // Chỉ cho phép neo vào một trong bốn góc; không lưu tọa độ tự do.
        const corner = nearestFabCorner(dragState.left + dx, dragState.top + dy);
        placeFab(corner.left, corner.top);
      }
    });
    const finishDrag = event => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const moved = dragState.dragging;
      dragState = null;
      fabButton.classList.remove('is-dragging');
      if (moved) {
        snapFabToNearestCorner();
        saveFabPosition();
        ignoreFabClick = true;
        window.setTimeout(() => { ignoreFabClick = false; }, 250);
      }
    };
    fabButton.addEventListener('pointerup', finishDrag);
    fabButton.addEventListener('pointercancel', finishDrag);
    document.addEventListener('pointerdown', event => {
      if (fabMenuOpen && !fabPinned && !fabButton.contains(event.target) && !fabMenu.contains(event.target)) closeMenu();
    });
    window.addEventListener('resize', () => {
      if (!fabButton) return;
      const rect = fabButton.getBoundingClientRect();
      placeFab(rect.left, rect.top);
      snapFabToNearestCorner();
      saveFabPosition();
    });
    document.addEventListener('fullscreenchange', updateToolbar);
    if (fabPinned) openMenu();
    updateToolbar();
  }

  function updateToolbar() {
    if (fabMenuOpen) renderMenuItems();
    if (fabMenuOpen) positionMenu();
    renderPresenterPanel();
  }

  function projectRelativePath() {
    const pathValue = String(htmlpresent.path || location.pathname).split(/[?#]/, 1)[0];
    const parts = pathValue.split('/').filter(Boolean);
    if (htmlpresent.tenantSlug && parts[0] === htmlpresent.tenantSlug && parts[1] === htmlpresent.projectSlug) {
      return parts.slice(2).join('/');
    }
    return parts[0] === slug ? parts.slice(1).join('/') : parts.join('/');
  }

  async function loadPrivateNotes() {
    if (!(htmlpresent.admin || htmlpresent.role === 'presenter')) return;
    const params = new URLSearchParams({
      slug,
      tenantSlug: String(htmlpresent.tenantSlug || ''),
      projectSlug: String(htmlpresent.projectSlug || slug),
      path: projectRelativePath()
    });
    try {
      const response = await fetch(`/__notes?${params}`, { credentials: 'same-origin' });
      if (!response.ok) return;
      const result = await response.json();
      if (result && result.notes && typeof result.notes === 'object') privateNotes = result.notes;
      renderPresenterPanel();
    } catch (_) {}
  }

  function authoredNote(slide) {
    if (!slide) return '';
    const dataNote = slide.getAttribute('data-note');
    if (dataNote && dataNote.trim()) return dataNote.trim();
    const aside = slide.querySelector('aside.notes, .notes');
    return aside ? String(aside.textContent || '').trim() : '';
  }

  function clearCloneNotes(clone) {
    clone.querySelectorAll('script, aside.notes, .notes').forEach(node => node.remove());
    clone.querySelectorAll('[data-note]').forEach(node => node.removeAttribute('data-note'));
    clone.removeAttribute('data-note');
  }

  // A preview is a visible snapshot, independent of a deck's active-slide CSS.
  function prepareVisibleClone(clone) {
    clone.classList.add('active');
    clone.removeAttribute('hidden');
    clone.style.setProperty('opacity', '1', 'important');
    clone.style.setProperty('visibility', 'visible', 'important');
    clone.style.setProperty('transition', 'none', 'important');
    clone.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'));
    clone.querySelectorAll('script').forEach(node => node.remove());
  }

  function renderPreview(container, index) {
    if (!container) return;
    const source = slides[index];
    if (!source) {
      container.style.removeProperty('--preview-bg');
      container.innerHTML = '<div class="htmlpresent-present-no-next">Đã đến slide cuối</div>';
      return;
    }
    // Đồng bộ nền + màu chữ preview theo slide gốc (slide tối → preview tối + chữ sáng).
    const bg = pickSlideBackground(source);
    if (bg) container.style.setProperty('--preview-bg', bg);
    else container.style.removeProperty('--preview-bg');
    const color = pickSlideColor(source);
    if (color) container.style.setProperty('--preview-color', color);
    else container.style.removeProperty('--preview-color');
    const clone = source.cloneNode(true);
    prepareVisibleClone(clone);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    // Deck landscape: slide gốc đã bị layout.js scale/translate → clone bỏ các
    // dấu vết đó để preview tự scale theo kích thước base.
    clone.classList.remove('htmlpresent-stage-inner');
    clone.style.transform = 'none';
    // Preview hiện ĐẦY ĐỦ slide (mọi bước data-step), để người trình bày thấy
    // trọn slide hiện tại/kế tiếp — không chỉ nền.
    clone.querySelectorAll('[data-step]').forEach(node => node.classList.add('in'));
    clearCloneNotes(clone);
    container.replaceChildren(clone);
    requestAnimationFrame(() => {
      if (!container.isConnected) return;
      const sourceRect = source.getBoundingClientRect(), box = container.getBoundingClientRect();
      const width = immersive ? baseW : Math.max(1, sourceRect.width || innerWidth);
      const height = immersive ? baseH : Math.max(1, sourceRect.height || innerHeight);
      const scale = Math.min(box.width / width, box.height / height);
      // Căn giữa preview trong khung (tránh letterbox đen dồn một phía).
      const offX = Math.max(0, (box.width - width * scale) / 2);
      const offY = Math.max(0, (box.height - height * scale) / 2);
      clone.style.position = 'absolute'; clone.style.left = `${offX}px`; clone.style.top = `${offY}px`;
      clone.style.width = `${width}px`; clone.style.height = `${height}px`; clone.style.minHeight = '0';
      clone.style.margin = '0'; clone.style.overflow = 'hidden'; clone.style.transformOrigin = 'top left';
      clone.style.transform = `scale(${scale})`;
    });
  }

  function pickSlideBackground(slide) {
    try {
      const transparent = (v) => !v || v === 'transparent' || /^rgba?\(0,\s*0,\s*0,\s*0\)$/.test(v);
      const read = (el) => {
        const s = getComputedStyle(el);
        return transparent(s.backgroundColor) ? '' : s.backgroundColor;
      };
      return read(slide) || read(document.body) || read(document.documentElement) || '';
    } catch (_) { return ''; }
  }

  function pickSlideColor(slide) {
    // Slide thường không khai báo color riêng cho body text (dùng inherit).
    // Lấy color từ body/html gốc để preview không bị áp màu của presenter panel.
    try {
      const read = (el) => {
        try { return getComputedStyle(el).color || ''; } catch (_) { return ''; }
      };
      return read(document.body) || read(document.documentElement) || read(slide) || '';
    } catch (_) { return ''; }
  }

  function formatClock() {
    const seconds = Math.max(0, Math.floor((Date.now() - presentationStartedAt) / 1000));
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function showPresenterPanel() {
    if (isAudience) return;
    if (!presentationStartedAt) presentationStartedAt = Date.now();
    if (!presenterPanel) {
      presenterPanel = document.createElement('section');
      presenterPanel.id = 'htmlpresent-presenter-panel';
      presenterPanel.setAttribute('aria-label', 'Màn hình người trình bày');
      presenterPanel.innerHTML = `<header class="htmlpresent-presenter-head">
        <div><strong>Người trình bày</strong><span class="htmlpresent-presenter-clock">00:00:00</span><span class="htmlpresent-presenter-count"></span><span class="htmlpresent-presenter-audience"></span></div>
        <nav aria-label="Điều khiển slide"><button type="button" data-panel="audience">Màn khán giả ↗</button><button type="button" data-panel="prev">← Trước</button><button type="button" data-panel="next">Tiếp →</button><button type="button" data-panel="black">Màn đen</button><button type="button" data-panel="fullscreen">Toàn màn hình</button><button type="button" data-panel="close">Đóng</button></nav>
      </header>
      <main class="htmlpresent-presenter-previews">
        <section><div class="htmlpresent-presenter-label">Slide hiện tại</div><div class="htmlpresent-presenter-current"></div></section>
        <section><div class="htmlpresent-presenter-label">Slide tiếp theo</div><div class="htmlpresent-presenter-next"></div></section>
      </main>
      <footer class="htmlpresent-presenter-notes"><div><strong>Ghi chú người trình bày</strong><span class="htmlpresent-presenter-note-source"></span></div><p></p></footer>`;
      document.body.appendChild(presenterPanel);
      presenterPanel.addEventListener('click', event => {
        const button = event.target.closest('[data-panel]'); if (!button) return;
        switch (button.dataset.panel) {
          case 'audience': openAudience(); break;
          case 'prev': move(-1); break;
          case 'next': move(1); break;
          case 'black': setBlackout(!blackout); break;
          case 'fullscreen': toggleFullscreen(); break;
          case 'close': closePresenterPanel(); break;
        }
      });
      loadPrivateNotes();
      clockTimer = setInterval(() => {
        const clock = presenterPanel && presenterPanel.querySelector('.htmlpresent-presenter-clock');
        if (clock) clock.textContent = formatClock();
      }, 1000);
    }
    renderPresenterPanel();
  }

  function closePresenterPanel() {
    if (presenterPanel) presenterPanel.remove();
    presenterPanel = null;
    clearInterval(clockTimer); clockTimer = null;
  }

  function renderPresenterPanel() {
    if (!presenterPanel) return;
    const currentSlide = slides[current];
    renderPreview(presenterPanel.querySelector('.htmlpresent-presenter-current'), current);
    renderPreview(presenterPanel.querySelector('.htmlpresent-presenter-next'), current + 1);
    presenterPanel.querySelector('.htmlpresent-presenter-count').textContent = `${current + 1} / ${slides.length}`;
    presenterPanel.querySelector('.htmlpresent-presenter-clock').textContent = formatClock();
    const privateNote = privateNotes[String(current + 1)];
    const hasPrivate = typeof privateNote === 'string' && privateNote.trim();
    const note = hasPrivate ? privateNote : authoredNote(currentSlide);
    const noteSource = presenterPanel.querySelector('.htmlpresent-presenter-note-source');
    noteSource.textContent = hasPrivate ? ' · Riêng tư' : (note ? ' · Trong HTML' : '');
    presenterPanel.querySelector('.htmlpresent-presenter-notes p').textContent = note || 'Slide này chưa có ghi chú.';
    const blackButton = presenterPanel.querySelector('[data-panel="black"]');
    if (blackButton) blackButton.textContent = blackout ? 'Mở màn hình' : 'Màn đen';
    const live = audienceWindow ? !audienceWindow.closed : audienceConnected;
    const audienceLabel = presenterPanel.querySelector('.htmlpresent-presenter-audience');
    if (audienceLabel) {
      audienceLabel.textContent = `Khán giả: ${audienceStatusText()}`;
      audienceLabel.classList.toggle('is-live', live || audienceConnected);
    }
    const audienceButton = presenterPanel.querySelector('[data-panel="audience"]');
    if (audienceButton) audienceButton.textContent = live ? 'Focus màn khán giả ↗' : 'Mở màn khán giả ↗';
  }

  let toastTimer = null;
  function showToast(message) {
    let toast = document.querySelector('.htmlpresent-present-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'htmlpresent-present-toast'; document.body.appendChild(toast); }
    toast.textContent = message; toast.classList.add('htmlpresent-visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('htmlpresent-visible'), 3000);
  }

  function isTypingTarget(target) {
    return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  // Khi edit.js bật chế độ sửa (class lt-editing trên <html>), present.js phải
  // ngưng mọi điều hướng — nếu không click vào vùng cần sửa sẽ bị tính là "Tiếp".
  function isEditing() {
    return document.documentElement.classList.contains('lt-editing');
  }

  function onKey(event) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (path.some(isTypingTarget) || isTypingTarget(document.activeElement)) {
      // Keep the browser default (caret/space/delete), but stop deck hotkeys.
      event.stopImmediatePropagation();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isEditing()) return;
    const key = event.key;
    if (key === 'Escape' && blackout) { event.preventDefault(); setBlackout(false); return; }
    // Enter/Space trên một nút/link → để chính nó xử lý, không điều hướng slide.
    if ((key === ' ' || key === 'Enter') && event.target.closest &&
        event.target.closest('button,a,[role="button"],summary')) return;
    if (key === 'Escape') {
      if (overviewOpen()) { event.preventDefault(); closeOverview(); return; }
      if (helpOpen()) { event.preventDefault(); closeHelp(); return; }
      if (fabMenuOpen) { event.preventDefault(); closeMenu(); fabButton?.focus(); return; }
      if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
      if (presenterPanel) { closePresenterPanel(); return; }
      return;
    }
    if (!presentationEnabled) return;
    if (overviewOpen()) { if (key === 'o' || key === 'O') { event.preventDefault(); closeOverview(); } return; }
    // Nhảy số: gõ chữ số rồi Enter.
    if (/^\d$/.test(key)) {
      goBuffer += key;
      clearTimeout(goBufferTimer);
      goBufferTimer = setTimeout(() => { goBuffer = ''; }, 1200);
      return;
    }
    if (key === 'Enter' && goBuffer) {
      event.preventDefault();
      const target = Number(goBuffer); goBuffer = ''; clearTimeout(goBufferTimer);
      if (Number.isFinite(target)) goTo(target - 1, true, { revealAll: true });
      if (isAudience) sendAudienceState();
      return;
    }
    goBuffer = '';
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Enter') { event.preventDefault(); move(1); }
    else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'Backspace') { event.preventDefault(); move(-1); }
    // ↑/↓: nhảy NGUYÊN slide (bỏ qua từng bước) và hiện hết bước của slide tới.
    else if (key === 'ArrowDown') { event.preventDefault(); goTo(Math.min(slides.length - 1, current + 1), true, { revealAll: true }); }
    else if (key === 'ArrowUp') { event.preventDefault(); goTo(Math.max(0, current - 1), true, { revealAll: true }); }
    else if (key === 'Home') { event.preventDefault(); goTo(0, true, { revealAll: true }); }
    else if (key === 'End') { event.preventDefault(); goTo(slides.length - 1, true, { revealAll: true }); }
    else if (key.toLowerCase() === 'b') { event.preventDefault(); setBlackout(!blackout); }
    else if (key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
    else if (key.toLowerCase() === 'a') { event.preventDefault(); setAutoplay(); }
    else if (key === '+' || key === '=') { event.preventDefault(); cycleSpeed(1); }
    else if (key === '-' || key === '_') { event.preventDefault(); cycleSpeed(-1); }
    else if (key === 'o' || key === 'O') { event.preventDefault(); toggleOverview(); }
    else if (key === '?' || key.toLowerCase() === 'h') { event.preventDefault(); toggleHelp(); }
    else if (key.toLowerCase() === 'p' && !isAudience) { event.preventDefault(); openAudience(); }
    else if (key.toLowerCase() === 'v' && !isAudience && allowedButton) { event.preventDefault(); togglePresenterPanel(); }
    if (isAudience) sendAudienceState();
  }

  function sendAudienceState() {
    if (!isAudience) return;
    const message = { ...state(), source: 'audience' };
    try { if (channel) channel.postMessage(message); } catch (_) {}
    try { localStorage.setItem(storageKey, JSON.stringify(message)); localStorage.removeItem(storageKey); } catch (_) {}
  }

  function updateAudience(message) {
    if (!audienceWindow || audienceWindow.closed) return;
    try {
      if (audienceWindow.__htmlpresentReceive) audienceWindow.__htmlpresentReceive(message);
      else audienceWindow.postMessage({ __htmlpresentPresent: message }, location.origin);
    } catch (_) {}
  }

  if (channel) channel.addEventListener('message', event => receive(event.data));
  window.addEventListener('storage', onStorage);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !event.data || !event.data.__htmlpresentPresent) return;
    receive(event.data.__htmlpresentPresent);
  });
  window.addEventListener('resize', () => { if (isAudience) fitAudienceSlide(audienceRoot?.firstElementChild); });
  window.addEventListener('scroll', () => {
    if (isAudience || (immersive && presentationEnabled) || guard || programmaticScroll) return;
    const next = detectCurrentSlide();
    if (next !== current) { current = next; updateToolbar(); sendState(); }
  }, { passive: true });
  window.addEventListener('keydown', onKey, true);
  buildStepGroups();
  if (immersive) document.documentElement.classList.add('lt-immersive');
  if (stepGroups.some(groups => groups.length)) document.documentElement.classList.add('lt-has-steps');
  if (isAudience) {
    slides.forEach((_, i) => applyReveal(i, i === current ? shown : 0));
    setupAudience();
    window.__htmlpresentReceive = receive;
  } else {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    const hashIndex = slides.findIndex((slide, i) => slideName(slide, i) === hash);
    if (hashIndex >= 0) current = hashIndex;
    slides.forEach((_, i) => applyReveal(i, i === current ? shown : 0));
    setupFab();
    setupProgress();
    setupImmersiveInput();
    if (hashIndex >= 0 || (immersive && presentationEnabled)) goTo(current, false);
    updateProgress();
    sendState();
  }

  window.LTPresent = {
    registerMenuItem,
    openMenu,
    closeMenu,
    getSlides: () => slides.slice(),
    currentIndex: () => current,
    hideFab,
    showFab
  };
  window.dispatchEvent(new CustomEvent('lt-present-ready'));
  window.htmlpresentPresent = { next: () => move(1), previous: () => move(-1), goTo, openAudience, setBlackout };
})();
