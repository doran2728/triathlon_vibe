document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const counterEl = document.getElementById('counter');
  const lapsSection = document.getElementById('lapsSection');
  const lapButtonsContainer = document.getElementById('lapButtons');
  const tagCountInput = document.getElementById('tagCount');

  let intervalId = null;
  let elapsed = 0;
  let totalTags = 0;
  const laps = {};

  const STORAGE_KEY = 'lapCounterState';

  /* ════════════════════════════════════════
     CORE UTILITIES  (exported for testing)
  ════════════════════════════════════════ */

  window._formatTime = function formatTime(ms) {
    const m   = Math.floor(ms / 60000).toString().padStart(2, '0');
    const s   = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const mil = (ms % 1000).toString().padStart(3, '0');
    return `${m}:${s}:${mil}`;
  };
  const formatTime = window._formatTime;

  window._buildExportRows = function buildExportRows(lapsObj, total) {
    const maxLaps = total === 0 ? 0
      : Math.max(0, ...Array.from({ length: total }, (_, i) => (lapsObj[i + 1] || []).length));
    const header = ['Runner', ...Array.from({ length: maxLaps }, (_, i) => `Lap ${i + 1}`)];
    const rows = [header];
    for (let i = 1; i <= total; i++) {
      const rl = lapsObj[i] || [];
      rows.push([`Runner ${i}`, ...rl, ...Array(maxLaps - rl.length).fill('')]);
    }
    return rows;
  };

  /* ════════════════════════════════════════
     PERSISTENCE — localStorage (silent)
  ════════════════════════════════════════ */

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        elapsed,
        totalTags,
        laps: JSON.parse(JSON.stringify(laps)),
        savedAt: Date.now(),
      }));
    } catch (e) { /* storage full — silently skip */ }
  };

  const clearState = () => localStorage.removeItem(STORAGE_KEY);

  /* Auto-save every 5 s while running */
  let autoSaveId = null;
  const startAutoSave = () => {
    clearInterval(autoSaveId);
    autoSaveId = setInterval(saveState, 5000);
  };
  const stopAutoSave = () => clearInterval(autoSaveId);

  /* ════════════════════════════════════════
     RENDER
  ════════════════════════════════════════ */

  const renderLapList = (num) => {
    const listDiv = document.getElementById(`lapList-${num}`);
    const undoBtn = document.getElementById(`undoBtn-${num}`);
    if (!listDiv) return;
    listDiv.innerHTML = '';
    (laps[num] || []).forEach((time, idx) => {
      const span = document.createElement('span');
      span.textContent = `#${idx + 1}  ${time}`;
      listDiv.appendChild(span);
    });
    listDiv.scrollTop = listDiv.scrollHeight;
    if (undoBtn) undoBtn.disabled = !(laps[num] && laps[num].length > 0);
  };

  const createTagCard = (num) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'lap-item';
    wrapper.id = `tagCard-${num}`;

    const btn = document.createElement('button');
    btn.className = 'btn lap-btn';
    btn.textContent = num;
    btn.id = `lapBtn-${num}`;
    btn.addEventListener('click', () => {
      if (!laps[num]) laps[num] = [];
      laps[num].push(formatTime(elapsed));
      renderLapList(num);
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
        laps[num].pop();
        renderLapList(num);
        saveState();
      }
    });

    wrapper.appendChild(btn);
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
      totalTags += 1;
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
    }
    lapButtonsContainer.appendChild(buildAddCard());
  };

  /* ════════════════════════════════════════
     TIMER
  ════════════════════════════════════════ */

  const tick = () => {
    elapsed += 10;
    counterEl.textContent = formatTime(elapsed);
  };

  const startFresh = () => {
    const count = Math.max(1, parseInt(tagCountInput.value, 10) || 20);
    tagCountInput.value = count;

    clearInterval(intervalId);
    intervalId = null;
    stopAutoSave();
    clearState();

    elapsed = 0;
    counterEl.textContent = formatTime(elapsed);
    Object.keys(laps).forEach((k) => delete laps[k]);
    createLapButtons(count);
    lapsSection.hidden = false;

    tagCountInput.disabled = true;
    downloadBtn.classList.remove('show');

    intervalId = setInterval(tick, 10);
    startAutoSave();

    startBtn.textContent = '↺ Restart';
    stopBtn.textContent  = '■ Pause';
    startBtn.classList.add('restart');
  };

  const togglePause = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      stopAutoSave();
      saveState();
      stopBtn.textContent = '▶ Resume';
      if (elapsed > 0) downloadBtn.classList.add('show');
    } else {
      intervalId = setInterval(tick, 10);
      startAutoSave();
      stopBtn.textContent = '■ Pause';
      downloadBtn.classList.remove('show');
    }
  };

  /* ════════════════════════════════════════
     EXCEL EXPORT
  ════════════════════════════════════════ */

  const exportToExcel = () => {
    const rows = window._buildExportRows(laps, totalTags);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map((_, ci) => ({
      wch: Math.max(...rows.map(r => String(r[ci] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Race Results');
    XLSX.writeFile(wb, `race_results_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.xlsx`);
  };

  startBtn.addEventListener('click', startFresh);
  stopBtn.addEventListener('click', togglePause);
  downloadBtn.addEventListener('click', exportToExcel);
});
