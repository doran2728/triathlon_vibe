document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const counterEl = document.getElementById('counter');
  const lapsSection = document.getElementById('lapsSection');
  const lapButtonsContainer = document.getElementById('lapButtons');
  const tagCountInput = document.getElementById('tagCount');
  const targetLapsInput = document.getElementById('targetLaps');

  let intervalId = null;
  let startTime = null;         // Timestamp when current running period started
  let accumulated = 0;          // Accumulated ms from previous running segments
  let isRunning = false;        // True while stopwatch is actively ticking
  let elapsed = 0;              // Current display elapsed time in ms

  let totalTags = 0;
  let targetLaps = 12.5;
  const laps = {};
  const runnerNames = {};

  const STORAGE_KEY = 'lapCounterState';

  /* ════════════════════════════════════════
     HAPTIC FEEDBACK
  ════════════════════════════════════════ */

  const vibrate = (pattern = 45) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  };

  /* ════════════════════════════════════════
     CORE UTILITIES  (exported for testing)
  ════════════════════════════════════════ */

  window._formatTime = function formatTime(ms) {
    const safeMs = Math.max(0, ms);
    const m   = Math.floor(safeMs / 60000).toString().padStart(2, '0');
    const s   = Math.floor((safeMs % 60000) / 1000).toString().padStart(2, '0');
    const mil = (safeMs % 1000).toString().padStart(3, '0');
    return `${m}:${s}:${mil}`;
  };
  const formatTime = window._formatTime;

  window._buildExportRows = function buildExportRows(lapsObj, total, namesObj = {}, targetLapsVal = 12.5) {
    const maxLaps = total === 0 ? 0
      : Math.max(0, ...Array.from({ length: total }, (_, i) => (lapsObj[i + 1] || []).length));
    const isHalf = (targetLapsVal % 1 !== 0);
    const targetM = Math.round(targetLapsVal * 400);

    const lapHeaders = Array.from({ length: maxLaps }, (_, i) => {
      const idx = i + 1;
      const meters = isHalf ? (200 + (idx - 1) * 400) : (idx * 400);
      const isFinish = (meters === targetM);
      return isFinish ? `${meters}m (Finish)` : `${meters}m`;
    });

    const header = ['Runner', ...lapHeaders, 'Total Time'];
    const rows = [header];
    for (let i = 1; i <= total; i++) {
      const rl = lapsObj[i] || [];
      const custom = namesObj && namesObj[i] && namesObj[i].trim();
      const label = custom ? `${i} - ${custom}` : `Runner ${i}`;
      const totalTime = rl.length > 0 ? rl[rl.length - 1] : '';
      rows.push([
        label,
        ...rl,
        ...Array(maxLaps - rl.length).fill(''),
        totalTime
      ]);
    }
    return rows;
  };

  /* ════════════════════════════════════════
     WALL-CLOCK TIMING ENGINE
     (Never drifts or freezes in background tabs)
  ════════════════════════════════════════ */

  const getElapsed = () => {
    if (isRunning && startTime) {
      return accumulated + (Date.now() - startTime);
    }
    return accumulated;
  };

  /* ════════════════════════════════════════
     RACE DISTANCE & LAP HELPERS
  ════════════════════════════════════════ */

  const getCompletedLaps = (splitCount) => {
    if (splitCount === 0) return 0;
    if (targetLaps % 1 !== 0) {
      return splitCount - 0.5;
    }
    return splitCount;
  };

  const getMaxSplits = () => {
    if (targetLaps % 1 !== 0) {
      return Math.ceil(targetLaps);
    }
    return targetLaps;
  };

  /* ════════════════════════════════════════
     PERSISTENCE — localStorage
  ════════════════════════════════════════ */

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startTime: isRunning ? startTime : null,
        accumulated: isRunning ? accumulated : getElapsed(),
        isRunning,
        totalTags,
        targetLaps,
        laps: JSON.parse(JSON.stringify(laps)),
        names: JSON.parse(JSON.stringify(runnerNames)),
        savedAt: Date.now(),
      }));
    } catch (e) { /* storage full — silently skip */ }
  };

  const clearState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startTime: null,
        accumulated: 0,
        isRunning: false,
        totalTags,
        targetLaps,
        laps: {},
        names: JSON.parse(JSON.stringify(runnerNames)),
        savedAt: Date.now(),
      }));
    } catch (e) {}
  };

  /* Auto-save every 4 seconds */
  let autoSaveId = null;
  const startAutoSave = () => {
    clearInterval(autoSaveId);
    autoSaveId = setInterval(saveState, 4000);
  };
  const stopAutoSave = () => clearInterval(autoSaveId);

  /* ════════════════════════════════════════
     RENDER & LAP BADGE LOGIC
  ════════════════════════════════════════ */

  const updateLapBadge = (num) => {
    const badge = document.getElementById(`lapBadge-${num}`);
    const card = document.getElementById(`tagCard-${num}`);
    const btn = document.getElementById(`lapBtn-${num}`);
    const count = (laps[num] || []).length;
    const completed = getCompletedLaps(count);
    const maxSplits = getMaxSplits();

    if (!badge) return;

    badge.classList.remove('bell', 'finished');
    if (card) card.classList.remove('is-bell', 'is-finished');

    if (count >= maxSplits) {
      badge.textContent = `🏁 ${completed}/${targetLaps}`;
      badge.classList.add('finished');
      if (card) card.classList.add('is-finished');
      if (btn) btn.textContent = '🏁';
    } else if (count === maxSplits - 1 && maxSplits > 1) {
      badge.textContent = `🔔 ${completed}/${targetLaps}`;
      badge.classList.add('bell');
      if (card) card.classList.add('is-bell');
      if (btn) btn.textContent = num;
    } else {
      badge.textContent = `${completed}/${targetLaps}`;
      if (btn) btn.textContent = num;
    }
  };

  const renderLapList = (num) => {
    const listDiv = document.getElementById(`lapList-${num}`);
    const undoBtn = document.getElementById(`undoBtn-${num}`);
    if (!listDiv) return;
    listDiv.innerHTML = '';
    const isHalf = (targetLaps % 1 !== 0);

    (laps[num] || []).forEach((time, idx) => {
      const span = document.createElement('span');
      const meters = isHalf ? (200 + idx * 400) : ((idx + 1) * 400);
      span.textContent = `${meters}m  ${time}`;
      listDiv.appendChild(span);
    });
    listDiv.scrollTop = listDiv.scrollHeight;
    if (undoBtn) undoBtn.disabled = !(laps[num] && laps[num].length > 0);
    updateLapBadge(num);
  };

  const createTagCard = (num) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'lap-item';
    wrapper.id = `tagCard-${num}`;

    const badge = document.createElement('span');
    badge.className = 'lap-badge';
    badge.id = `lapBadge-${num}`;
    badge.textContent = `0/${targetLaps}`;

    const btn = document.createElement('button');
    btn.className = 'btn lap-btn';
    btn.textContent = num;
    btn.id = `lapBtn-${num}`;
    btn.addEventListener('click', () => {
      const curElapsed = getElapsed();
      if (!isRunning && curElapsed === 0) return;
      const count = (laps[num] || []).length;
      if (count >= getMaxSplits()) {
        vibrate([25, 30, 25]);
        return;
      }
      vibrate(45);
      if (!laps[num]) laps[num] = [];
      laps[num].push(formatTime(curElapsed));
      renderLapList(num);
      saveState();
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'runner-name-input';
    nameInput.placeholder = `Runner ${num}`;
    nameInput.value = runnerNames[num] || '';
    nameInput.maxLength = 24;
    nameInput.title = `Name for Runner #${num}`;
    nameInput.addEventListener('input', () => {
      runnerNames[num] = nameInput.value;
      saveState();
    });

    const listDiv = document.createElement('div');
    listDiv.className = 'lap-list';
    listDiv.id = `lapList-${num}`;

    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn undo-btn';
    undoBtn.id = `undoBtn-${num}`;
    undoBtn.textContent = '↩';
    undoBtn.title = 'Undo last lap';
    undoBtn.disabled = true;
    undoBtn.addEventListener('click', () => {
      if (laps[num] && laps[num].length > 0) {
        vibrate([30, 40, 30]);
        laps[num].pop();
        renderLapList(num);
        saveState();
      }
    });

    wrapper.appendChild(badge);
    wrapper.appendChild(btn);
    wrapper.appendChild(nameInput);
    wrapper.appendChild(listDiv);
    wrapper.appendChild(undoBtn);
    return wrapper;
  };

  const buildAddCard = () => {
    const addCard = document.createElement('div');
    addCard.className = 'lap-item add-card';
    addCard.id = 'addRunnerCard';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add a runner';
    addBtn.addEventListener('click', () => {
      vibrate(35);
      totalTags += 1;
      tagCountInput.value = totalTags;
      if (totalTags > parseInt(tagCountInput.max, 10)) {
        tagCountInput.max = totalTags;
      }
      const card = createTagCard(totalTags);
      lapButtonsContainer.insertBefore(card, addCard);
      addCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      saveState();
    });

    addCard.appendChild(addBtn);
    return addCard;
  };

  const createLapButtons = (count) => {
    lapButtonsContainer.innerHTML = '';
    totalTags = count;
    for (let i = 1; i <= count; i++) {
      lapButtonsContainer.appendChild(createTagCard(i));
      if (laps[i] && laps[i].length) {
        renderLapList(i);
      }
    }
    lapButtonsContainer.appendChild(buildAddCard());
  };

  /* ════════════════════════════════════════
     TIMER TICK & VISIBILITY SYNC
  ════════════════════════════════════════ */

  const tick = () => {
    elapsed = getElapsed();
    counterEl.textContent = formatTime(elapsed);
  };

  // Immediate catch-up whenever user switches back to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      elapsed = getElapsed();
      counterEl.textContent = formatTime(elapsed);
    }
  });

  const startFresh = () => {
    vibrate(60);
    const count = Math.max(1, parseInt(tagCountInput.value, 10) || 20);
    tagCountInput.value = count;

    targetLaps = Math.max(0.5, parseFloat(targetLapsInput.value) || 12.5);
    targetLapsInput.value = targetLaps;

    clearInterval(intervalId);
    intervalId = null;
    stopAutoSave();
    clearState();

    accumulated = 0;
    startTime = Date.now();
    isRunning = true;
    elapsed = 0;
    counterEl.textContent = formatTime(0);

    Object.keys(laps).forEach((k) => delete laps[k]);
    createLapButtons(count);
    lapsSection.hidden = false;

    tagCountInput.disabled = true;
    targetLapsInput.disabled = true;
    downloadBtn.classList.remove('show');
    stopBtn.hidden = false;

    intervalId = setInterval(tick, 20);
    startAutoSave();

    startBtn.textContent = '↺ Restart';
    stopBtn.textContent  = '■ Pause';
    startBtn.classList.add('restart');
  };

  const togglePause = () => {
    vibrate(45);
    if (isRunning) {
      // Running → Pause
      accumulated = getElapsed();
      isRunning = false;
      startTime = null;
      clearInterval(intervalId);
      intervalId = null;
      stopAutoSave();
      saveState();

      elapsed = accumulated;
      counterEl.textContent = formatTime(elapsed);
      stopBtn.textContent = '▶ Resume';
      if (elapsed > 0) downloadBtn.classList.add('show');
    } else {
      // Paused → Resume
      startTime = Date.now();
      isRunning = true;
      intervalId = setInterval(tick, 20);
      startAutoSave();
      saveState();

      stopBtn.textContent = '■ Pause';
      downloadBtn.classList.remove('show');
    }
  };

  /* ════════════════════════════════════════
     EXCEL EXPORT
  ════════════════════════════════════════ */

  const exportToExcel = () => {
    const rows = window._buildExportRows(laps, totalTags, runnerNames, targetLaps);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map((_, ci) => ({
      wch: Math.max(...rows.map(r => String(r[ci] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Race Results');
    XLSX.writeFile(wb, `race_results_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.xlsx`);
  };

  /* ════════════════════════════════════════
     INITIALIZATION & SESSION RESTORE
  ════════════════════════════════════════ */

  let savedState = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) savedState = JSON.parse(raw);
  } catch (e) {}

  if (savedState) {
    if (savedState.names) Object.assign(runnerNames, savedState.names);
    if (savedState.laps)  Object.assign(laps, savedState.laps);
    if (savedState.targetLaps) {
      targetLaps = savedState.targetLaps;
      if (targetLapsInput) targetLapsInput.value = targetLaps;
    }
    if (savedState.totalTags) {
      totalTags = savedState.totalTags;
      if (tagCountInput) tagCountInput.value = totalTags;
    }
  }

  if (targetLapsInput) {
    targetLaps = Math.max(0.5, parseFloat(targetLapsInput.value) || 12.5);
  }

  const initialCount = Math.max(1, parseInt(tagCountInput.value, 10) || 20);
  createLapButtons(initialCount);

  // Restore active or paused race if present
  if (savedState && (savedState.isRunning || (savedState.accumulated > 0))) {
    accumulated = savedState.accumulated || 0;
    isRunning = !!savedState.isRunning;

    if (isRunning && savedState.startTime) {
      startTime = savedState.startTime;
      intervalId = setInterval(tick, 20);
      startAutoSave();
      stopBtn.textContent = '■ Pause';
      downloadBtn.classList.remove('show');
    } else {
      isRunning = false;
      startTime = null;
      stopBtn.textContent = '▶ Resume';
      if (accumulated > 0) downloadBtn.classList.add('show');
    }

    elapsed = getElapsed();
    counterEl.textContent = formatTime(elapsed);

    startBtn.textContent = '↺ Restart';
    startBtn.classList.add('restart');
    stopBtn.hidden = false;
    tagCountInput.disabled = true;
    targetLapsInput.disabled = true;
  }

  tagCountInput.addEventListener('input', () => {
    if (!isRunning && getElapsed() === 0) {
      const count = Math.max(1, parseInt(tagCountInput.value, 10) || 1);
      createLapButtons(count);
    }
  });

  if (targetLapsInput) {
    targetLapsInput.addEventListener('input', () => {
      targetLaps = Math.max(0.5, parseFloat(targetLapsInput.value) || 12.5);
      for (let i = 1; i <= totalTags; i++) {
        updateLapBadge(i);
        renderLapList(i);
      }
      saveState();
    });
  }

  startBtn.addEventListener('click', startFresh);
  stopBtn.addEventListener('click', togglePause);
  downloadBtn.addEventListener('click', exportToExcel);
});
