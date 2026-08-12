// Visual File Explorer (Dual Pane) Client Controller

const leftPane = {
  mode: 'local', // 'local' or 'cloud'
  remote: '',
  path: 'drives',
  items: [],
  selected: new Set()
};

const rightPane = {
  mode: 'cloud', // 'cloud' or 'local'
  remote: 'combined',
  path: '',
  items: [],
  selected: new Set()
};

let ws = null;

// DOM Elements
const selectLeftMode = document.getElementById('select-left-mode');
const selectLeftRemote = document.getElementById('select-left-remote');
const inputLocalPath = document.getElementById('input-local-path');
const btnLocalGo = document.getElementById('btn-local-go');
const btnLocalUp = document.getElementById('btn-local-up');
const btnLocalHome = document.getElementById('btn-local-home');
const btnLocalMkdir = document.getElementById('btn-local-mkdir');
const tbodyLocal = document.getElementById('tbody-local');
const chkLocalAll = document.getElementById('chk-local-all');
const footerLocalInfo = document.getElementById('footer-local-info');
const footerLocalSelected = document.getElementById('footer-local-selected');

const selectRightMode = document.getElementById('select-right-mode');
const selectCloudRemote = document.getElementById('select-cloud-remote');
const inputCloudPath = document.getElementById('input-cloud-path');
const btnCloudGo = document.getElementById('btn-cloud-go');
const btnCloudUp = document.getElementById('btn-cloud-up');
const btnCloudHome = document.getElementById('btn-cloud-home');
const btnCloudMkdir = document.getElementById('btn-cloud-mkdir');
const tbodyCloud = document.getElementById('tbody-cloud');
const chkCloudAll = document.getElementById('chk-cloud-all');
const footerCloudInfo = document.getElementById('footer-cloud-info');
const footerCloudSelected = document.getElementById('footer-cloud-selected');

const btnGlobalRefresh = document.getElementById('btn-global-refresh');

// Action Toolbar Buttons
const btnCopyCloud = document.getElementById('btn-action-copy-to-cloud');
const btnCopyLocal = document.getElementById('btn-action-copy-to-local');
const btnMoveCloud = document.getElementById('btn-action-move-to-cloud');
const btnMoveLocal = document.getElementById('btn-action-move-to-local');
const btnSync = document.getElementById('btn-action-sync');
const btnDelete = document.getElementById('btn-action-delete');

// Progress Footer Elements
const progressBox = document.getElementById('explorer-progress-box');
const progressTitle = document.getElementById('explorer-op-title');
const progressPercent = document.getElementById('explorer-op-percent');
const progressBarFill = document.getElementById('explorer-op-bar-fill');
const progressSize = document.getElementById('explorer-op-size');
const progressSpeed = document.getElementById('explorer-op-speed');
const progressEta = document.getElementById('explorer-op-eta');
const progressLog = document.getElementById('explorer-op-log');

// Format Helpers
async function safeFetchJson(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    if (!res.ok) {
      throw new Error(`Error en el servidor (${res.status}): ${text.substring(0, 150)}`);
    }
    throw new Error(`Respuesta no válida (${res.status}): ${text.substring(0, 100)}`);
  }
  return data;
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// WebSocket Connection
function initSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'transfer_status') {
        updateProgressUI(msg.running, msg.stats, msg.success, msg.error, msg.queueCount);
        renderQueueStack(msg.running, msg.stats, msg.queue, msg.isQueuePaused, msg.completedTasks);
      }
    } catch (e) {}
  };
}

// Inline Task Queue & History Controller
let currentQueueList = [];
let currentCompletedList = [];
let isQueuePausedState = false;

const btnToggleQueuePause = document.getElementById('btn-toggle-queue-pause');
const btnClearQueue = document.getElementById('btn-clear-queue');
const queueStackContainer = document.getElementById('queue-stack-container');
const queueBadgeCount = document.getElementById('queue-badge-count');
const activeTransferBarWrapper = document.getElementById('active-transfer-bar-wrapper');

if (btnToggleQueuePause) {
  btnToggleQueuePause.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/transfer/queue/toggle-pause', { method: 'POST' });
      const data = await safeFetchJson(res);
      btnToggleQueuePause.innerText = data.isQueuePaused ? '▶️ Reanudar Cola' : '⏸️ Pausar Cola';
    } catch (e) {
      alert(e.message);
    }
  });
}

if (btnClearQueue) {
  btnClearQueue.addEventListener('click', async () => {
    try {
      await fetch('/api/transfer/queue/clear', { method: 'POST' });
      await fetch('/api/transfer/queue/clear-history', { method: 'POST' });
    } catch (e) {
      alert(e.message);
    }
  });
}

async function removeTaskFromQueue(id) {
  try {
    const res = await fetch('/api/transfer/queue/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await safeFetchJson(res);
  } catch (e) {
    alert(e.message);
  }
}

function renderQueueStack(running, stats, queue, isQueuePaused, completedTasks) {
  currentQueueList = queue || [];
  currentCompletedList = completedTasks || [];
  isQueuePausedState = !!isQueuePaused;

  const totalPendingOrActive = (running ? 1 : 0) + currentQueueList.length;
  const totalCount = totalPendingOrActive + currentCompletedList.length;

  if (queueBadgeCount) queueBadgeCount.innerText = totalCount;
  if (btnToggleQueuePause) {
    btnToggleQueuePause.innerText = isQueuePausedState ? '▶️ Reanudar Cola' : '⏸️ Pausar Cola';
  }

  if (running && stats && activeTransferBarWrapper) {
    activeTransferBarWrapper.classList.remove('hidden');
  } else if (activeTransferBarWrapper) {
    activeTransferBarWrapper.classList.add('hidden');
  }

  if (totalCount > 0 || running) {
    progressBox.classList.remove('hidden');
  }

  if (!queueStackContainer) return;

  if (totalCount === 0 && !running) {
    queueStackContainer.innerHTML = `
      <div class="empty-state-small" style="padding: 10px;">
        <span style="font-size: 18px;">📋</span>
        <p style="margin-top: 4px; font-size: 12px;">No hay tareas acumuladas ni en cola.</p>
      </div>
    `;
    return;
  }

  let html = '';

  // 1. Pending Tasks
  currentQueueList.forEach((task, idx) => {
    const badgeClass = isQueuePausedState ? 'badge-paused' : 'badge-pending';
    const badgeText = isQueuePausedState ? `PAUSADO (Puesto #${idx + 1})` : `PENDIENTE (Puesto #${idx + 1})`;

    html += `
      <div class="queue-card-item">
        <div class="queue-card-header">
          <span class="queue-badge ${badgeClass}">⏳ ${badgeText} - ${task.action.toUpperCase()}</span>
          <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 10px; width: auto; border-color: rgba(255,62,108,0.3); color: #ff4d4d;" onclick="removeTaskFromQueue('${task.id}')" title="Sacar de la cola">
            ❌ Sacar
          </button>
        </div>
        <div class="queue-card-paths">
          <span>${task.sourceArg}</span>
          <span style="color: var(--accent-color);">➔</span>
          <span>${task.destArg}</span>
        </div>
      </div>
    `;
  });

  // 2. Completed / Failed Tasks
  currentCompletedList.forEach(task => {
    const isSuccess = task.status === 'completed';
    const badgeText = isSuccess ? `✅ COMPLETADO (${task.completedAt})` : `❌ FALLIDO (${task.completedAt})`;

    html += `
      <div class="queue-card-item" style="opacity: 0.85; border-color: ${isSuccess ? 'rgba(46,204,113,0.3)' : 'rgba(255,77,77,0.3)'};">
        <div class="queue-card-header">
          <span class="queue-badge" style="background: ${isSuccess ? 'rgba(46,204,113,0.15)' : 'rgba(255,77,77,0.15)'}; color: ${isSuccess ? '#2ecc71' : '#ff4d4d'}; border: 1px solid ${isSuccess ? 'rgba(46,204,113,0.3)' : 'rgba(255,77,77,0.3)'};">
            ${badgeText} - ${task.action.toUpperCase()}
          </span>
          ${task.error ? `<span style="font-size: 11px; color: #ff4d4d;">${task.error}</span>` : ''}
        </div>
        <div class="queue-card-paths">
          <span>${task.sourceArg}</span>
          <span style="color: var(--accent-color);">➔</span>
          <span>${task.destArg}</span>
        </div>
      </div>
    `;
  });

  queueStackContainer.innerHTML = html;
}

function updateProgressUI(running, stats, success, error, queueCount) {
  const qLen = (stats && stats.queueLength !== undefined) ? stats.queueLength : (queueCount || 0);
  const queueBadge = qLen > 0 ? ` [📋 En cola: ${qLen}]` : '';

  if (running) {
    progressBox.classList.remove('hidden');
    if (stats) {
      const isScanning = stats.progress === 0 && (stats.speed === '0 B/s' || (stats.transferred && stats.transferred.startsWith('0 B')));
      progressTitle.innerText = `Operación (${stats.mode}): ${stats.source} ➔ ${stats.destination}${queueBadge}`;
      progressPercent.innerText = `${stats.progress}%`;
      progressBarFill.style.width = `${Math.max(stats.progress, 5)}%`;
      progressSize.innerText = `${stats.transferred} / ${stats.total}`;
      progressSpeed.innerText = isScanning ? '🔍 Escaneando...' : stats.speed;
      progressEta.innerText = isScanning ? 'Escaneando elementos...' : `ETA: ${stats.eta}`;
      if (stats.lastLog) {
        progressLog.innerText = isScanning
          ? `🔍 Escaneando e indexando estructura de archivos... (${stats.lastLog})`
          : stats.lastLog;
      }
    }
  } else {
    if (qLen > 0) {
      progressLog.innerText = `Iniciando siguiente tarea en cola... (${qLen} pendientes)`;
    } else if (success === true) {
      progressLog.innerText = '¡Todas las transferencias han finalizado con éxito!';
      progressPercent.innerText = '100%';
      progressBarFill.style.width = '100%';
      setTimeout(() => {
        progressBox.classList.add('hidden');
        loadLeftPane(leftPane.path);
        loadRightPane(rightPane.remote, rightPane.path);
      }, 1500);
    } else if (error) {
      progressLog.innerText = `Error: ${error}`;
      progressTitle.innerText = 'Operación Fallida';
    }
  }
}

// Populate Cloud Remotes Dropdowns
async function loadRemotes() {
  try {
    const res = await fetch('/api/drives');
    const drives = await safeFetchJson(res);
    
    [selectLeftRemote, selectCloudRemote].forEach(selectEl => {
      if (!selectEl) return;
      selectEl.innerHTML = '';
      
      const hasUnion = drives.some(d => d.name === 'combined');
      if (hasUnion) {
        const opt = document.createElement('option');
        opt.value = 'combined';
        opt.innerText = '📁 Unidad Fusionada (combined)';
        selectEl.appendChild(opt);
      }
      
      drives.forEach(d => {
        if (d.name !== 'combined') {
          const opt = document.createElement('option');
          opt.value = d.name;
          opt.innerText = `☁️ ${d.name} (${d.type})`;
          selectEl.appendChild(opt);
        }
      });
    });

    if (selectCloudRemote.options.length > 0) {
      rightPane.remote = selectCloudRemote.value;
      if (rightPane.mode === 'cloud') {
        loadRightPane(rightPane.remote, '');
      }
    }
    if (selectLeftRemote && selectLeftRemote.options.length > 0) {
      leftPane.remote = selectLeftRemote.value;
      if (leftPane.mode === 'cloud') {
        loadLeftPane('');
      }
    }
  } catch (e) {
    console.error('Error loading remotes:', e);
  }
}

// -------------------------------------------------------------
// LEFT PANE LOGIC
// -------------------------------------------------------------
async function loadLeftPane(reqPath) {
  tbodyLocal.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Cargando...</td></tr>';
  leftPane.selected.clear();
  chkLocalAll.checked = false;
  updateLeftSelectedCount();

  if (leftPane.mode === 'local') {
    try {
      const res = await fetch(`/api/fs/local/ls?path=${encodeURIComponent(reqPath || 'drives')}`);
      const data = await safeFetchJson(res);

      leftPane.path = data.isDrivesRoot ? 'drives' : data.currentPath;
      inputLocalPath.value = data.isDrivesRoot ? 'Discos de este Equipo' : data.currentPath;
      leftPane.items = data.items || [];

      renderLeftTable(data.items, data.isDrivesRoot);
    } catch (err) {
      tbodyLocal.innerHTML = `<tr><td colspan="4" style="color: #ff4d4d; padding: 20px; text-align: center;">${err.message}</td></tr>`;
    }
  } else {
    try {
      const targetRemote = leftPane.remote || 'combined';
      const res = await fetch(`/api/fs/cloud/ls?remote=${encodeURIComponent(targetRemote)}&path=${encodeURIComponent(reqPath || '')}`);
      const data = await safeFetchJson(res);

      leftPane.remote = data.remote;
      leftPane.path = data.currentPath || '';
      inputLocalPath.value = leftPane.path ? `/${leftPane.path}` : '/ (Raíz)';
      leftPane.items = data.items || [];

      renderLeftTable(data.items, false);
    } catch (err) {
      tbodyLocal.innerHTML = `<tr><td colspan="4" style="color: #ff4d4d; padding: 20px; text-align: center;">${err.message}</td></tr>`;
    }
  }
}

function renderLeftTable(items, isDrivesRoot) {
  tbodyLocal.innerHTML = '';
  if (!items || items.length === 0) {
    tbodyLocal.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Carpeta vacía</td></tr>';
    footerLocalInfo.innerText = '0 elementos';
    return;
  }

  footerLocalInfo.innerText = `${items.length} elementos`;

  items.forEach(item => {
    const tr = document.createElement('tr');
    const isChecked = leftPane.selected.has(item.path);
    if (isChecked) tr.classList.add('selected');

    const icon = item.isDrive ? '💽' : (item.isDir ? '📁' : '📄');
    const sizeStr = item.isDrive ? `${formatBytes(item.free)} libres` : (item.isDir ? '-' : formatBytes(item.size));

    tr.innerHTML = `
      <td><input type="checkbox" class="chk-local-item" data-path="${item.path}" ${isChecked ? 'checked' : ''}></td>
      <td>
        <div class="item-name">
          <span class="item-icon">${icon}</span>
          <span>${item.name}</span>
        </div>
      </td>
      <td>${sizeStr}</td>
      <td>${item.isDrive ? 'Dispositivo' : formatDate(item.modTime)}</td>
    `;

    const chk = tr.querySelector('.chk-local-item');
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleLeftSelect(item.path, chk.checked, tr);
    });

    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const nextState = !leftPane.selected.has(item.path);
      chk.checked = nextState;
      toggleLeftSelect(item.path, nextState, tr);
    });

    tr.addEventListener('dblclick', () => {
      if (item.isDir || item.isDrive) {
        loadLeftPane(item.path);
      }
    });

    tbodyLocal.appendChild(tr);
  });
}

function toggleLeftSelect(itemPath, select, tr) {
  if (select) {
    leftPane.selected.add(itemPath);
    tr.classList.add('selected');
  } else {
    leftPane.selected.delete(itemPath);
    tr.classList.remove('selected');
  }
  updateLeftSelectedCount();
}

function updateLeftSelectedCount() {
  footerLocalSelected.innerText = `${leftPane.selected.size} seleccionados`;
}

// -------------------------------------------------------------
// RIGHT PANE LOGIC
// -------------------------------------------------------------
async function loadRightPane(remote, reqPath) {
  tbodyCloud.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Cargando...</td></tr>';
  rightPane.selected.clear();
  chkCloudAll.checked = false;
  updateRightSelectedCount();

  if (rightPane.mode === 'cloud') {
    try {
      const targetRemote = remote || rightPane.remote || 'combined';
      const res = await fetch(`/api/fs/cloud/ls?remote=${encodeURIComponent(targetRemote)}&path=${encodeURIComponent(reqPath || '')}`);
      const data = await safeFetchJson(res);

      rightPane.remote = data.remote;
      rightPane.path = data.currentPath || '';
      inputCloudPath.value = rightPane.path ? `/${rightPane.path}` : '/ (Raíz)';
      rightPane.items = data.items || [];

      renderRightTable(data.items, false);
    } catch (err) {
      tbodyCloud.innerHTML = `<tr><td colspan="4" style="color: #ff4d4d; padding: 20px; text-align: center;">${err.message}</td></tr>`;
    }
  } else {
    try {
      const res = await fetch(`/api/fs/local/ls?path=${encodeURIComponent(reqPath || 'drives')}`);
      const data = await safeFetchJson(res);

      rightPane.path = data.isDrivesRoot ? 'drives' : data.currentPath;
      inputCloudPath.value = data.isDrivesRoot ? 'Discos de este Equipo' : data.currentPath;
      rightPane.items = data.items || [];

      renderRightTable(data.items, data.isDrivesRoot);
    } catch (err) {
      tbodyCloud.innerHTML = `<tr><td colspan="4" style="color: #ff4d4d; padding: 20px; text-align: center;">${err.message}</td></tr>`;
    }
  }
}

function renderRightTable(items, isDrivesRoot) {
  tbodyCloud.innerHTML = '';
  if (!items || items.length === 0) {
    tbodyCloud.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Carpeta vacía</td></tr>';
    footerCloudInfo.innerText = '0 elementos';
    return;
  }

  footerCloudInfo.innerText = `${items.length} elementos`;

  items.forEach(item => {
    const tr = document.createElement('tr');
    const isChecked = rightPane.selected.has(item.path);
    if (isChecked) tr.classList.add('selected');

    const icon = item.isDrive ? '💽' : (item.isDir ? '📁' : '📄');
    const sizeStr = item.isDrive ? `${formatBytes(item.free)} libres` : (item.isDir ? '-' : formatBytes(item.size));

    tr.innerHTML = `
      <td><input type="checkbox" class="chk-cloud-item" data-path="${item.path}" ${isChecked ? 'checked' : ''}></td>
      <td>
        <div class="item-name">
          <span class="item-icon">${icon}</span>
          <span>${item.name}</span>
        </div>
      </td>
      <td>${sizeStr}</td>
      <td>${item.isDrive ? 'Dispositivo' : formatDate(item.modTime)}</td>
    `;

    const chk = tr.querySelector('.chk-cloud-item');
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleRightSelect(item.path, chk.checked, tr);
    });

    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const nextState = !rightPane.selected.has(item.path);
      chk.checked = nextState;
      toggleRightSelect(item.path, nextState, tr);
    });

    tr.addEventListener('dblclick', () => {
      if (item.isDir || item.isDrive) {
        loadRightPane(rightPane.remote, item.path);
      }
    });

    tbodyCloud.appendChild(tr);
  });
}

function toggleRightSelect(itemPath, select, tr) {
  if (select) {
    rightPane.selected.add(itemPath);
    tr.classList.add('selected');
  } else {
    rightPane.selected.delete(itemPath);
    tr.classList.remove('selected');
  }
  updateRightSelectedCount();
}

function updateRightSelectedCount() {
  footerCloudSelected.innerText = `${rightPane.selected.size} seleccionados`;
}

// -------------------------------------------------------------
// EVENT BINDINGS & ACTIONS
// -------------------------------------------------------------

// Mode Selectors Change Handlers
if (selectLeftMode) {
  selectLeftMode.addEventListener('change', () => {
    leftPane.mode = selectLeftMode.value;
    if (leftPane.mode === 'cloud') {
      selectLeftRemote.classList.remove('hidden');
      leftPane.remote = selectLeftRemote.value || 'combined';
      leftPane.path = '';
      loadLeftPane('');
    } else {
      selectLeftRemote.classList.add('hidden');
      leftPane.path = 'drives';
      loadLeftPane('drives');
    }
  });
}

if (selectLeftRemote) {
  selectLeftRemote.addEventListener('change', () => {
    leftPane.remote = selectLeftRemote.value;
    loadLeftPane('');
  });
}

if (selectRightMode) {
  selectRightMode.addEventListener('change', () => {
    rightPane.mode = selectRightMode.value;
    if (rightPane.mode === 'cloud') {
      selectCloudRemote.classList.remove('hidden');
      rightPane.remote = selectCloudRemote.value || 'combined';
      rightPane.path = '';
      loadRightPane(rightPane.remote, '');
    } else {
      selectCloudRemote.classList.add('hidden');
      rightPane.path = 'drives';
      loadRightPane('', 'drives');
    }
  });
}

if (selectCloudRemote) {
  selectCloudRemote.addEventListener('change', () => {
    rightPane.remote = selectCloudRemote.value;
    loadRightPane(rightPane.remote, '');
  });
}

// Navigation Left Pane
btnLocalGo.addEventListener('click', () => {
  let val = inputLocalPath.value.trim();
  if (leftPane.mode === 'cloud') val = val.replace(/^\/+/, '');
  loadLeftPane(val);
});
btnLocalHome.addEventListener('click', () => loadLeftPane(leftPane.mode === 'local' ? 'drives' : ''));
btnLocalUp.addEventListener('click', () => {
  if (leftPane.mode === 'local') {
    if (leftPane.path === 'drives') return;
    const parent = leftPane.path.lastIndexOf('\\') > 2 ? leftPane.path.substring(0, leftPane.path.lastIndexOf('\\')) : (leftPane.path.endsWith(':\\') ? 'drives' : `${leftPane.path.substring(0, 2)}\\`);
    loadLeftPane(parent);
  } else {
    if (!leftPane.path) return;
    const parent = leftPane.path.includes('/') ? leftPane.path.substring(0, leftPane.path.lastIndexOf('/')) : '';
    loadLeftPane(parent);
  }
});

// Navigation Right Pane
btnCloudGo.addEventListener('click', () => {
  let val = inputCloudPath.value.trim();
  if (rightPane.mode === 'cloud') val = val.replace(/^\/+/, '');
  loadRightPane(rightPane.remote, val);
});
btnCloudHome.addEventListener('click', () => loadRightPane(rightPane.remote, rightPane.mode === 'local' ? 'drives' : ''));
btnCloudUp.addEventListener('click', () => {
  if (rightPane.mode === 'cloud') {
    if (!rightPane.path) return;
    const parent = rightPane.path.includes('/') ? rightPane.path.substring(0, rightPane.path.lastIndexOf('/')) : '';
    loadRightPane(rightPane.remote, parent);
  } else {
    if (rightPane.path === 'drives') return;
    const parent = rightPane.path.lastIndexOf('\\') > 2 ? rightPane.path.substring(0, rightPane.path.lastIndexOf('\\')) : (rightPane.path.endsWith(':\\') ? 'drives' : `${rightPane.path.substring(0, 2)}\\`);
    loadRightPane(rightPane.remote, parent);
  }
});

// Select All Checkboxes
chkLocalAll.addEventListener('change', () => {
  const check = chkLocalAll.checked;
  leftPane.selected.clear();
  document.querySelectorAll('#tbody-local tr').forEach(tr => {
    const chk = tr.querySelector('.chk-local-item');
    if (chk) {
      chk.checked = check;
      const itemPath = chk.getAttribute('data-path');
      if (check) {
        leftPane.selected.add(itemPath);
        tr.classList.add('selected');
      } else {
        tr.classList.remove('selected');
      }
    }
  });
  updateLeftSelectedCount();
});

chkCloudAll.addEventListener('change', () => {
  const check = chkCloudAll.checked;
  rightPane.selected.clear();
  document.querySelectorAll('#tbody-cloud tr').forEach(tr => {
    const chk = tr.querySelector('.chk-cloud-item');
    if (chk) {
      chk.checked = check;
      const itemPath = chk.getAttribute('data-path');
      if (check) {
        rightPane.selected.add(itemPath);
        tr.classList.add('selected');
      } else {
        tr.classList.remove('selected');
      }
    }
  });
  updateRightSelectedCount();
});

// Global Refresh
btnGlobalRefresh.addEventListener('click', () => {
  loadLeftPane(leftPane.path);
  loadRightPane(rightPane.remote, rightPane.path);
});

// Mkdir Handlers
btnLocalMkdir.addEventListener('click', async () => {
  if (leftPane.mode === 'local' && leftPane.path === 'drives') {
    alert('Navega dentro de un disco local para crear una carpeta.');
    return;
  }
  const name = prompt('Ingresa el nombre de la nueva carpeta:');
  if (!name) return;

  try {
    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mkdir',
        dstType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
        dstPath: leftPane.path,
        newDirName: name
      })
    });
    if (res.ok) {
      loadLeftPane(leftPane.path);
    } else {
      const data = await res.json();
      alert(`Error al crear carpeta: ${data.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

btnCloudMkdir.addEventListener('click', async () => {
  if (rightPane.mode === 'local' && rightPane.path === 'drives') {
    alert('Navega dentro de un disco local para crear una carpeta.');
    return;
  }
  const name = prompt('Ingresa el nombre de la nueva carpeta:');
  if (!name) return;

  try {
    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mkdir',
        dstType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
        dstPath: rightPane.path,
        newDirName: name
      })
    });
    if (res.ok) {
      loadRightPane(rightPane.remote, rightPane.path);
    } else {
      const data = await res.json();
      alert(`Error al crear carpeta: ${data.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

const selectOverwriteMode = document.getElementById('select-overwrite-mode');

// -------------------------------------------------------------
// TRANSFER ACTION HANDLERS (Copy, Move, Sync, Delete)
// -------------------------------------------------------------
async function executeOperation(payload) {
  try {
    const mode = selectOverwriteMode ? selectOverwriteMode.value : 'update';
    payload.overwriteMode = mode;

    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await safeFetchJson(res);
    if (!res.ok) {
      alert(`Error en la operación: ${data.error || 'Error desconocido'}`);
    } else {
      progressBox.classList.remove('hidden');
      if (data.status === 'queued') {
        progressLog.innerText = `📌 Tarea agregada a la cola de espera (Puesto #${data.position})`;
      } else {
        progressLog.innerText = `Iniciando transferencia... (${data.message || ''})`;
      }
    }
  } catch (e) {
    alert(e.message);
  }
}

// Copy Left -> Right
btnCopyCloud.addEventListener('click', () => {
  if (leftPane.selected.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en el panel izquierdo.');
    return;
  }
  if (rightPane.mode === 'local' && rightPane.path === 'drives') {
    alert('Selecciona una carpeta o disco destino válido en el panel derecho.');
    return;
  }
  const selectedItems = leftPane.items.filter(i => leftPane.selected.has(i.path));
  executeOperation({
    action: 'copy',
    srcType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
    srcPath: leftPane.path,
    dstType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
    dstPath: rightPane.path,
    items: selectedItems
  });
});

// Copy Right -> Left
btnCopyLocal.addEventListener('click', () => {
  if (rightPane.selected.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en el panel derecho.');
    return;
  }
  if (leftPane.mode === 'local' && leftPane.path === 'drives') {
    alert('Selecciona una carpeta o disco destino válido en el panel izquierdo.');
    return;
  }
  const selectedItems = rightPane.items.filter(i => rightPane.selected.has(i.path));
  executeOperation({
    action: 'copy',
    srcType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
    srcPath: rightPane.path,
    dstType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
    dstPath: leftPane.path,
    items: selectedItems
  });
});

// Move Left -> Right
btnMoveCloud.addEventListener('click', () => {
  if (leftPane.selected.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en el panel izquierdo.');
    return;
  }
  if (rightPane.mode === 'local' && rightPane.path === 'drives') {
    alert('Selecciona una carpeta o disco destino válido en el panel derecho.');
    return;
  }
  if (!confirm('¿Estás seguro de MOVER los elementos seleccionados del panel izquierdo al derecho? (Se borrarán del origen al completar).')) return;
  const selectedItems = leftPane.items.filter(i => leftPane.selected.has(i.path));
  executeOperation({
    action: 'move',
    srcType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
    srcPath: leftPane.path,
    dstType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
    dstPath: rightPane.path,
    items: selectedItems
  });
});

// Move Right -> Left
btnMoveLocal.addEventListener('click', () => {
  if (rightPane.selected.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en el panel derecho.');
    return;
  }
  if (leftPane.mode === 'local' && leftPane.path === 'drives') {
    alert('Selecciona una carpeta o disco destino válido en el panel izquierdo.');
    return;
  }
  if (!confirm('¿Estás seguro de MOVER los elementos seleccionados del panel derecho al izquierdo? (Se borrarán del origen al completar).')) return;
  const selectedItems = rightPane.items.filter(i => rightPane.selected.has(i.path));
  executeOperation({
    action: 'move',
    srcType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
    srcPath: rightPane.path,
    dstType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
    dstPath: leftPane.path,
    items: selectedItems
  });
});

// Sync Left -> Right
btnSync.addEventListener('click', () => {
  if (leftPane.mode === 'local' && leftPane.path === 'drives') {
    alert('Selecciona una carpeta válida en el panel izquierdo para sincronizar.');
    return;
  }
  const leftName = leftPane.mode === 'local' ? leftPane.path : `${leftPane.remote}:${leftPane.path}`;
  const rightName = rightPane.mode === 'local' ? rightPane.path : `${rightPane.remote}:${rightPane.path}`;

  if (!confirm(`ADVERTENCIA DE SINCRONIZACIÓN:\n\nEsto hará que el destino (${rightName}) sea EXACTAMENTE IDÉNTICO al origen (${leftName}).\n\n¡Cualquier archivo en el destino que no exista en el origen será ELIMINADO del destino!\n\n¿Deseas continuar?`)) return;

  executeOperation({
    action: 'sync',
    srcType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
    srcPath: leftPane.path,
    dstType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
    dstPath: rightPane.path
  });
});

// Delete Selected
btnDelete.addEventListener('click', () => {
  const selectedLefts = leftPane.items.filter(i => leftPane.selected.has(i.path));
  const selectedRights = rightPane.items.filter(i => rightPane.selected.has(i.path));

  if (selectedLefts.length === 0 && selectedRights.length === 0) {
    alert('Selecciona al menos un elemento en la columna izquierda o derecha para eliminar.');
    return;
  }

  const totalCount = selectedLefts.length + selectedRights.length;
  if (!confirm(`¿Estás seguro de eliminar permanentemente ${totalCount} elementos seleccionados?`)) return;

  if (selectedLefts.length > 0) {
    executeOperation({ action: 'delete', srcType: leftPane.mode === 'local' ? 'local' : leftPane.remote, items: selectedLefts });
  }
  if (selectedRights.length > 0) {
    executeOperation({ action: 'delete', srcType: rightPane.mode === 'local' ? 'local' : rightPane.remote, items: selectedRights });
  }
});

// Cancel Active Operation / Clear Queue Button
const btnCancelExplorerOp = document.getElementById('btn-cancel-explorer-op');
if (btnCancelExplorerOp) {
  btnCancelExplorerOp.addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de que deseas cancelar la operación activa y vaciar la cola de transferencias pendientes?')) return;
    try {
      const res = await fetch('/api/transfer/cancel', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        progressLog.innerText = data.message || 'Operación cancelada.';
      } else {
        alert(`Error al cancelar: ${data.error}`);
      }
    } catch (e) {
      alert(`Error de conexión: ${e.message}`);
    }
  });
}

// Folder Comparison & Audit Controller
const btnCompare = document.getElementById('btn-action-compare');
const modalCompareResult = document.getElementById('modal-compare-result');
const btnCloseCompareModal = document.getElementById('btn-close-compare-modal');
const compareModalBody = document.getElementById('compare-modal-body');

if (btnCloseCompareModal) {
  btnCloseCompareModal.addEventListener('click', () => {
    modalCompareResult.classList.add('hidden');
  });
}

if (btnCompare) {
  btnCompare.addEventListener('click', async () => {
    if (leftPane.mode === 'local' && leftPane.path === 'drives') {
      alert('Selecciona una carpeta o disco en el panel izquierdo para comparar.');
      return;
    }
    if (rightPane.mode === 'local' && rightPane.path === 'drives') {
      alert('Selecciona una carpeta o disco en el panel derecho para comparar.');
      return;
    }

    modalCompareResult.classList.remove('hidden');
    compareModalBody.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 10px;">⏳</div>
        <p style="font-weight: 600; color: #fff;">Escaneando y comparando elementos en ambos lados...</p>
        <span style="font-size: 12px;">Analizando número de archivos, bytes totales y diferencias</span>
      </div>
    `;

    try {
      const res = await fetch('/api/fs/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srcType: leftPane.mode === 'local' ? 'local' : leftPane.remote,
          srcPath: leftPane.path,
          dstType: rightPane.mode === 'local' ? 'local' : rightPane.remote,
          dstPath: rightPane.path
        })
      });

      const data = await safeFetchJson(res);
      if (!res.ok) {
        compareModalBody.innerHTML = `<div style="color: #ff4d4d; padding: 20px; text-align: center;">Error: ${data.error}</div>`;
        return;
      }

      renderCompareResults(data);
    } catch (e) {
      compareModalBody.innerHTML = `<div style="color: #ff4d4d; padding: 20px; text-align: center;">Error de conexión: ${e.message}</div>`;
    }
  });
}

function renderCompareResults(data) {
  const statusBadge = data.isIdentical
    ? `<div style="background: rgba(46, 204, 113, 0.15); border: 1px solid rgba(46, 204, 113, 0.4); color: #2ecc71; padding: 10px 14px; border-radius: 8px; font-weight: 700; text-align: center; margin-bottom: 15px;">🟢 AMBAS CARPETAS SON 100% IDÉNTICAS EN ARCHIVOS Y PESO</div>`
    : `<div style="background: rgba(255, 193, 7, 0.15); border: 1px solid rgba(255, 193, 7, 0.4); color: #ffc107; padding: 10px 14px; border-radius: 8px; font-weight: 700; text-align: center; margin-bottom: 15px;">⚠️ SE ENCONTRARON DIFERENCIAS ENTRE AMBAS CARPETAS</div>`;

  compareModalBody.innerHTML = `
    ${statusBadge}

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
      <!-- Left Source Card -->
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); border-radius: 10px; padding: 14px;">
        <h4 style="margin: 0 0 8px 0; color: var(--accent-color); font-size: 14px;">💻 Origen (Panel Izquierdo)</h4>
        <div style="font-size: 11px; color: var(--text-muted); word-break: break-all; margin-bottom: 10px;">${data.sourceTarget}</div>
        <div style="font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 4px;">${formatBytes(data.srcStats.bytes)}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${(data.srcStats.count || 0).toLocaleString()} archivos</div>
      </div>

      <!-- Right Dest Card -->
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); border-radius: 10px; padding: 14px;">
        <h4 style="margin: 0 0 8px 0; color: var(--primary-color); font-size: 14px;">☁️ Destino (Panel Derecho)</h4>
        <div style="font-size: 11px; color: var(--text-muted); word-break: break-all; margin-bottom: 10px;">${data.destTarget}</div>
        <div style="font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 4px;">${formatBytes(data.dstStats.bytes)}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${(data.dstStats.count || 0).toLocaleString()} archivos</div>
      </div>
    </div>

    <!-- Differences Breakdown -->
    <div style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px;">
      <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #fff;">📊 Desglose de Auditoría:</h4>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">🟢 Archivos Idénticos:</span>
          <span style="font-weight: 700; color: #2ecc71;">${data.matching.toLocaleString()}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">📥 Faltantes en el Destino:</span>
          <span style="font-weight: 700; color: ${data.missingInDest > 0 ? '#ffc107' : '#fff'};">${data.missingInDest.toLocaleString()}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">⚠️ Archivos Modificados (difiere tamaño/fecha):</span>
          <span style="font-weight: 700; color: ${data.differing > 0 ? '#ff4d4d' : '#fff'};">${data.differing.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;
}

// App Startup
initSocket();
loadRemotes();
loadLeftPane('C:\\');
