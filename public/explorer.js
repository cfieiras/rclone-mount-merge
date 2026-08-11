// Visual File Explorer (Dual Pane) Client Controller

let localCurrentPath = 'drives';
let localItems = [];
let selectedLocalPaths = new Set();

let cloudRemote = 'combined';
let cloudCurrentPath = '';
let cloudItems = [];
let selectedCloudPaths = new Set();

let ws = null;

// DOM Elements
const inputLocalPath = document.getElementById('input-local-path');
const btnLocalGo = document.getElementById('btn-local-go');
const btnLocalUp = document.getElementById('btn-local-up');
const btnLocalHome = document.getElementById('btn-local-home');
const btnLocalMkdir = document.getElementById('btn-local-mkdir');
const tbodyLocal = document.getElementById('tbody-local');
const chkLocalAll = document.getElementById('chk-local-all');
const footerLocalInfo = document.getElementById('footer-local-info');
const footerLocalSelected = document.getElementById('footer-local-selected');

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
      }
    } catch (e) {}
  };
}

function updateProgressUI(running, stats, success, error, queueCount) {
  const qLen = (stats && stats.queueLength !== undefined) ? stats.queueLength : (queueCount || 0);
  const queueBadge = qLen > 0 ? ` [📋 En cola: ${qLen}]` : '';

  if (running) {
    progressBox.classList.remove('hidden');
    if (stats) {
      progressTitle.innerText = `Operación (${stats.mode}): ${stats.source} ➔ ${stats.destination}${queueBadge}`;
      progressPercent.innerText = `${stats.progress}%`;
      progressBarFill.style.width = `${stats.progress}%`;
      progressSize.innerText = `${stats.transferred} / ${stats.total}`;
      progressSpeed.innerText = stats.speed;
      progressEta.innerText = `ETA: ${stats.eta}`;
      if (stats.lastLog) progressLog.innerText = stats.lastLog;
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
        loadLocalDirectory(localCurrentPath);
        loadCloudDirectory(cloudRemote, cloudCurrentPath);
      }, 1500);
    } else if (error) {
      progressLog.innerText = `Error: ${error}`;
      progressTitle.innerText = 'Operación Fallida';
    }
  }
}

// Populate Cloud Remotes Dropdown
async function loadRemotes() {
  try {
    const res = await fetch('/api/drives');
    const drives = await res.json();
    selectCloudRemote.innerHTML = '';
    
    // Add combined first if exists
    const hasUnion = drives.some(d => d.name === 'combined');
    if (hasUnion) {
      const opt = document.createElement('option');
      opt.value = 'combined';
      opt.innerText = '📁 Unidad Fusionada (combined)';
      selectCloudRemote.appendChild(opt);
    }
    
    drives.forEach(d => {
      if (d.name !== 'combined') {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.innerText = `☁️ ${d.name} (${d.type})`;
        selectCloudRemote.appendChild(opt);
      }
    });

    if (selectCloudRemote.options.length > 0) {
      cloudRemote = selectCloudRemote.value;
      loadCloudDirectory(cloudRemote, '');
    }
  } catch (e) {
    console.error('Error loading remotes:', e);
  }
}

// -------------------------------------------------------------
// LOCAL SYSTEM PANE LOGIC
// -------------------------------------------------------------
async function loadLocalDirectory(reqPath) {
  tbodyLocal.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Cargando...</td></tr>';
  selectedLocalPaths.clear();
  chkLocalAll.checked = false;
  updateLocalSelectedCount();

  try {
    const res = await fetch(`/api/fs/local/ls?path=${encodeURIComponent(reqPath)}`);
    if (!res.ok) throw new Error('No se pudo cargar la carpeta local');
    const data = await res.json();

    localCurrentPath = data.isDrivesRoot ? 'drives' : data.currentPath;
    inputLocalPath.value = data.isDrivesRoot ? 'Discos de este Equipo' : data.currentPath;
    localItems = data.items || [];

    renderLocalTable(data.items, data.isDrivesRoot);
  } catch (err) {
    tbodyLocal.innerHTML = `<tr><td colspan="4" style="color: #ff4d4d; padding: 20px; text-align: center;">${err.message}</td></tr>`;
  }
}

function renderLocalTable(items, isDrivesRoot) {
  tbodyLocal.innerHTML = '';
  if (!items || items.length === 0) {
    tbodyLocal.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Carpeta vacía</td></tr>';
    footerLocalInfo.innerText = '0 elementos';
    return;
  }

  footerLocalInfo.innerText = `${items.length} elementos`;

  items.forEach(item => {
    const tr = document.createElement('tr');
    const isChecked = selectedLocalPaths.has(item.path);
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

    // Row selection and navigation events
    const chk = tr.querySelector('.chk-local-item');
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleLocalSelect(item.path, chk.checked, tr);
    });

    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const nextState = !selectedLocalPaths.has(item.path);
      chk.checked = nextState;
      toggleLocalSelect(item.path, nextState, tr);
    });

    tr.addEventListener('dblclick', () => {
      if (item.isDir || item.isDrive) {
        loadLocalDirectory(item.path);
      }
    });

    tbodyLocal.appendChild(tr);
  });
}

function toggleLocalSelect(itemPath, select, tr) {
  if (select) {
    selectedLocalPaths.add(itemPath);
    tr.classList.add('selected');
  } else {
    selectedLocalPaths.delete(itemPath);
    tr.classList.remove('selected');
  }
  updateLocalSelectedCount();
}

function updateLocalSelectedCount() {
  footerLocalSelected.innerText = `${selectedLocalPaths.size} seleccionados`;
}

// -------------------------------------------------------------
// CLOUD STORAGE PANE LOGIC
// -------------------------------------------------------------
async function loadCloudDirectory(remote, reqPath) {
  tbodyCloud.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Cargando nube...</td></tr>';
  selectedCloudPaths.clear();
  chkCloudAll.checked = false;
  updateCloudSelectedCount();

  try {
    const res = await fetch(`/api/fs/cloud/ls?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(reqPath)}`);
    if (!res.ok) throw new Error('No se pudo cargar la carpeta en la nube');
    const data = await res.json();

    cloudRemote = data.remote;
    cloudCurrentPath = data.currentPath || '';
    inputCloudPath.value = cloudCurrentPath ? `/${cloudCurrentPath}` : '/ (Raíz)';
    cloudItems = data.items || [];

    renderCloudTable(data.items);
  } catch (err) {
    tbodyCloud.innerHTML = `<tr><td colspan="4" style="color: #ff4d4d; padding: 20px; text-align: center;">${err.message}</td></tr>`;
  }
}

function renderCloudTable(items) {
  tbodyCloud.innerHTML = '';
  if (!items || items.length === 0) {
    tbodyCloud.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Carpeta vacía</td></tr>';
    footerCloudInfo.innerText = '0 elementos';
    return;
  }

  footerCloudInfo.innerText = `${items.length} elementos`;

  items.forEach(item => {
    const tr = document.createElement('tr');
    const isChecked = selectedCloudPaths.has(item.path);
    if (isChecked) tr.classList.add('selected');

    const icon = item.isDir ? '📁' : '📄';
    const sizeStr = item.isDir ? '-' : formatBytes(item.size);

    tr.innerHTML = `
      <td><input type="checkbox" class="chk-cloud-item" data-path="${item.path}" ${isChecked ? 'checked' : ''}></td>
      <td>
        <div class="item-name">
          <span class="item-icon">${icon}</span>
          <span>${item.name}</span>
        </div>
      </td>
      <td>${sizeStr}</td>
      <td>${formatDate(item.modTime)}</td>
    `;

    const chk = tr.querySelector('.chk-cloud-item');
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleCloudSelect(item.path, chk.checked, tr);
    });

    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const nextState = !selectedCloudPaths.has(item.path);
      chk.checked = nextState;
      toggleCloudSelect(item.path, nextState, tr);
    });

    tr.addEventListener('dblclick', () => {
      if (item.isDir) {
        loadCloudDirectory(cloudRemote, item.path);
      }
    });

    tbodyCloud.appendChild(tr);
  });
}

function toggleCloudSelect(itemPath, select, tr) {
  if (select) {
    selectedCloudPaths.add(itemPath);
    tr.classList.add('selected');
  } else {
    selectedCloudPaths.delete(itemPath);
    tr.classList.remove('selected');
  }
  updateCloudSelectedCount();
}

function updateCloudSelectedCount() {
  footerCloudSelected.innerText = `${selectedCloudPaths.size} seleccionados`;
}

// -------------------------------------------------------------
// EVENT BINDINGS & ACTIONS
// -------------------------------------------------------------

// Navigation local
btnLocalGo.addEventListener('click', () => loadLocalDirectory(inputLocalPath.value));
btnLocalHome.addEventListener('click', () => loadLocalDirectory('drives'));
btnLocalUp.addEventListener('click', () => {
  if (localCurrentPath === 'drives') return;
  const parent = localCurrentPath.lastIndexOf('\\') > 2 ? localCurrentPath.substring(0, localCurrentPath.lastIndexOf('\\')) : (localCurrentPath.endsWith(':\\') ? 'drives' : `${localCurrentPath.substring(0, 2)}\\`);
  loadLocalDirectory(parent);
});

// Select All Checkboxes
chkLocalAll.addEventListener('change', () => {
  const check = chkLocalAll.checked;
  selectedLocalPaths.clear();
  document.querySelectorAll('#tbody-local tr').forEach(tr => {
    const chk = tr.querySelector('.chk-local-item');
    if (chk) {
      chk.checked = check;
      const itemPath = chk.getAttribute('data-path');
      if (check) {
        selectedLocalPaths.add(itemPath);
        tr.classList.add('selected');
      } else {
        tr.classList.remove('selected');
      }
    }
  });
  updateLocalSelectedCount();
});

chkCloudAll.addEventListener('change', () => {
  const check = chkCloudAll.checked;
  selectedCloudPaths.clear();
  document.querySelectorAll('#tbody-cloud tr').forEach(tr => {
    const chk = tr.querySelector('.chk-cloud-item');
    if (chk) {
      chk.checked = check;
      const itemPath = chk.getAttribute('data-path');
      if (check) {
        selectedCloudPaths.add(itemPath);
        tr.classList.add('selected');
      } else {
        tr.classList.remove('selected');
      }
    }
  });
  updateCloudSelectedCount();
});

// Navigation cloud
selectCloudRemote.addEventListener('change', () => {
  cloudRemote = selectCloudRemote.value;
  loadCloudDirectory(cloudRemote, '');
});

btnCloudGo.addEventListener('click', () => {
  let val = inputCloudPath.value.trim().replace(/^\/+/, '');
  loadCloudDirectory(cloudRemote, val);
});
btnCloudHome.addEventListener('click', () => loadCloudDirectory(cloudRemote, ''));
btnCloudUp.addEventListener('click', () => {
  if (!cloudCurrentPath) return;
  const parent = cloudCurrentPath.includes('/') ? cloudCurrentPath.substring(0, cloudCurrentPath.lastIndexOf('/')) : '';
  loadCloudDirectory(cloudRemote, parent);
});

// Global Refresh
btnGlobalRefresh.addEventListener('click', () => {
  loadLocalDirectory(localCurrentPath);
  loadCloudDirectory(cloudRemote, cloudCurrentPath);
});

// Mkdir Handlers
btnLocalMkdir.addEventListener('click', async () => {
  if (localCurrentPath === 'drives') {
    alert('Navega dentro de un disco local para crear una carpeta.');
    return;
  }
  const name = prompt('Ingresa el nombre de la nueva carpeta local:');
  if (!name) return;

  try {
    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mkdir', dstType: 'local', dstPath: localCurrentPath, newDirName: name })
    });
    if (res.ok) {
      loadLocalDirectory(localCurrentPath);
    } else {
      const data = await res.json();
      alert(`Error al crear carpeta: ${data.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

btnCloudMkdir.addEventListener('click', async () => {
  const name = prompt('Ingresa el nombre de la nueva carpeta en la nube:');
  if (!name) return;

  try {
    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mkdir', dstType: cloudRemote, dstPath: cloudCurrentPath, newDirName: name })
    });
    if (res.ok) {
      loadCloudDirectory(cloudRemote, cloudCurrentPath);
    } else {
      const data = await res.json();
      alert(`Error al crear carpeta: ${data.error}`);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
});

// -------------------------------------------------------------
// TRANSFER ACTION HANDLERS (Copy, Move, Sync, Delete)
// -------------------------------------------------------------
async function executeOperation(payload) {
  try {
    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Error iniciando operación: ${data.error}`);
    } else if (data.status === 'queued') {
      progressBox.classList.remove('hidden');
      progressLog.innerText = `📌 Tarea agregada a la cola de espera (Puesto #${data.position})`;
    }
  } catch (e) {
    alert(`Error al conectar con el servidor: ${e.message}`);
  }
}

// Copy Local -> Cloud
btnCopyCloud.addEventListener('click', () => {
  if (selectedLocalPaths.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en la columna izquierda (PC).');
    return;
  }
  const selectedItems = localItems.filter(i => selectedLocalPaths.has(i.path));
  executeOperation({
    action: 'copy',
    srcType: 'local',
    srcPath: localCurrentPath,
    dstType: cloudRemote,
    dstPath: cloudCurrentPath,
    items: selectedItems
  });
});

// Copy Cloud -> Local
btnCopyLocal.addEventListener('click', () => {
  if (selectedCloudPaths.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en la columna derecha (Nube).');
    return;
  }
  if (localCurrentPath === 'drives') {
    alert('Selecciona una carpeta o disco destino válido en la columna izquierda.');
    return;
  }
  const selectedItems = cloudItems.filter(i => selectedCloudPaths.has(i.path));
  executeOperation({
    action: 'copy',
    srcType: cloudRemote,
    srcPath: cloudCurrentPath,
    dstType: 'local',
    dstPath: localCurrentPath,
    items: selectedItems
  });
});

// Move Local -> Cloud
btnMoveCloud.addEventListener('click', () => {
  if (selectedLocalPaths.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en la columna izquierda (PC).');
    return;
  }
  if (!confirm('¿Estás seguro de MOVER los elementos seleccionados del PC a la Nube? (Se borrarán del PC origen al completar).')) return;
  const selectedItems = localItems.filter(i => selectedLocalPaths.has(i.path));
  executeOperation({
    action: 'move',
    srcType: 'local',
    srcPath: localCurrentPath,
    dstType: cloudRemote,
    dstPath: cloudCurrentPath,
    items: selectedItems
  });
});

// Move Cloud -> Local
btnMoveLocal.addEventListener('click', () => {
  if (selectedCloudPaths.size === 0) {
    alert('Selecciona al menos un archivo o carpeta en la columna derecha (Nube).');
    return;
  }
  if (localCurrentPath === 'drives') {
    alert('Selecciona una carpeta o disco destino válido en la columna izquierda.');
    return;
  }
  if (!confirm('¿Estás seguro de MOVER los elementos seleccionados de la Nube al PC? (Se borrarán de la Nube origen al completar).')) return;
  const selectedItems = cloudItems.filter(i => selectedCloudPaths.has(i.path));
  executeOperation({
    action: 'move',
    srcType: cloudRemote,
    srcPath: cloudCurrentPath,
    dstType: 'local',
    dstPath: localCurrentPath,
    items: selectedItems
  });
});

// Sync Local -> Cloud
btnSync.addEventListener('click', () => {
  if (localCurrentPath === 'drives') {
    alert('Selecciona una carpeta local válida en la columna izquierda para sincronizar.');
    return;
  }
  const targetCloudName = cloudCurrentPath ? `${cloudRemote}:/${cloudCurrentPath}` : `${cloudRemote}: (Raíz)`;
  if (!confirm(`ADVERTENCIA DE SINCRONIZACIÓN:\n\nEsto hará que el destino (${targetCloudName}) sea EXACTAMENTE IDÉNTICO al origen local (${localCurrentPath}).\n\n¡Cualquier archivo en el destino que no exista en el origen será ELIMINADO del destino!\n\n¿Deseas continuar?`)) return;

  executeOperation({
    action: 'sync',
    srcType: 'local',
    srcPath: localCurrentPath,
    dstType: cloudRemote,
    dstPath: cloudCurrentPath
  });
});

// Delete Selected
btnDelete.addEventListener('click', () => {
  const selectedLocals = localItems.filter(i => selectedLocalPaths.has(i.path));
  const selectedClouds = cloudItems.filter(i => selectedCloudPaths.has(i.path));

  if (selectedLocals.length === 0 && selectedClouds.length === 0) {
    alert('Selecciona al menos un elemento en la columna izquierda o derecha para eliminar.');
    return;
  }

  const totalCount = selectedLocals.length + selectedClouds.length;
  if (!confirm(`¿Estás seguro de eliminar permanentemente ${totalCount} elementos seleccionados?`)) return;

  if (selectedLocals.length > 0) {
    executeOperation({ action: 'delete', srcType: 'local', items: selectedLocals });
  }
  if (selectedClouds.length > 0) {
    executeOperation({ action: 'delete', srcType: cloudRemote, items: selectedClouds });
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

// App Startup
initSocket();
loadRemotes();
loadLocalDirectory('C:\\');
