let socket;
let drivesData = [];
let mountState = {
  mounted: false,
  config: null
};
let isWinFspInstalled = false;

// DOM Elements
const loaderOverlay = document.getElementById('loader-overlay');
const loaderTitle = document.getElementById('loader-title');
const loaderDesc = document.getElementById('loader-desc');
const loaderProgress = document.getElementById('loader-progress');

const statusRcloneText = document.getElementById('status-rclone-text');
const statusRcloneIndicator = document.querySelector('#status-rclone .status-indicator');

const statusWinfspText = document.getElementById('status-winfsp-text');
const statusWinfspIndicator = document.querySelector('#status-winfsp .status-indicator');

const statusMountText = document.getElementById('status-mount-text');
const statusMountIndicator = document.querySelector('#status-mount .status-indicator');

const statusCacheText = document.getElementById('status-cache-text');
const statusCacheIndicator = document.querySelector('#status-cache .status-indicator');
const btnClearCache = document.getElementById('btn-clear-cache');

const btnAddOneDrive = document.getElementById('btn-add-onedrive');
const btnManualConfig = document.getElementById('btn-manual-config');
const btnAppShutdown = document.getElementById('btn-app-shutdown');
const btnOpenExplorer = document.getElementById('btn-open-explorer');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnCreateUnion = document.getElementById('btn-create-union');
const btnToggleMount = document.getElementById('btn-toggle-mount');

const drivesContainer = document.getElementById('drives-container');
const unionSelectList = document.getElementById('union-select-list');
const unionStatusBadge = document.getElementById('union-status-badge');
const selectDriveLetter = document.getElementById('select-drive-letter');
const selectMountMethod = document.getElementById('select-mount-method');
const winfspAlertBanner = document.getElementById('winfsp-alert-banner');
// Transfer Direct Card Elements
const btnModeCopy = document.getElementById('btn-mode-copy');
const btnModeSync = document.getElementById('btn-mode-sync');
const inputTransferSource = document.getElementById('input-transfer-source');
const selectTransferDest = document.getElementById('select-transfer-dest');
const inputTransferSubfolder = document.getElementById('input-transfer-subfolder');
const btnStartTransfer = document.getElementById('btn-start-transfer');
const btnCancelTransfer = document.getElementById('btn-cancel-transfer');
const transferProgressContainer = document.getElementById('transfer-progress-container');
const transferProgressPercent = document.getElementById('transfer-progress-percent');
const transferProgressSpeed = document.getElementById('transfer-progress-speed');
const transferProgressBarFill = document.getElementById('transfer-progress-bar-fill');
const transferProgressSize = document.getElementById('transfer-progress-size');
const transferProgressEta = document.getElementById('transfer-progress-eta');

let activeTransferMode = 'copy';
let isTransferRunning = false;
let activeTransferStats = null;

// Safe JSON fetch helper
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

// Modals
const modalAdd = document.getElementById('modal-add');
const modalOauth = document.getElementById('modal-oauth');
const oauthConsole = document.getElementById('oauth-console');
const inputDriveName = document.getElementById('input-drive-name');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalConfirm = document.getElementById('btn-modal-confirm');
const btnOauthCancel = document.getElementById('btn-oauth-cancel');

// Initialize WebSockets
function initSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    switch (msg.type) {
      case 'status':
        updateSystemStatus(msg.data);
        break;
        
      case 'download_status':
        handleDownloadProgress(msg);
        break;
        
      case 'log':
        appendLog(msg.data.message, msg.data.type);
        if (modalOauth.classList.contains('hidden') === false) {
          appendOAuthConsole(msg.data.message);
        }
        break;
        
      case 'setup_complete':
        modalOauth.classList.add('hidden');
        if (msg.success) {
          appendLog(`OneDrive setup finished for account: ${msg.name}`, 'success');
          refreshData();
        } else {
          appendLog(`OneDrive setup failed or was cancelled for account: ${msg.name}`, 'error');
          alert(`La configuración de la cuenta "${msg.name}" falló o fue cancelada por errores de autorización de Microsoft.\n\nPor favor, utiliza el botón "Config. Manual" en la interfaz para configurar esta cuenta manualmente en una ventana de comandos.`);
        }
        break;
        
      case 'mount_status':
        updateMountStatus(msg.mounted, msg.config);
        break;

      case 'mount_failed':
        appendLog(`Error al montar: ${msg.error}`, 'error');
        alert(msg.error);
        break;

      case 'transfer_status':
        updateTransferStatus(msg.running, msg.stats);
        if (msg.running === false && msg.success !== undefined) {
          if (msg.success) {
            appendLog(`¡Transferencia de fondo completada con éxito!`, 'success');
            alert('¡Transferencia completada con éxito!');
          } else {
            appendLog(`La transferencia falló o fue cancelada: ${msg.error || ''}`, 'error');
            alert(`La transferencia falló o fue cancelada: ${msg.error || ''}`);
          }
        }
        break;
    }
  };

  socket.onclose = () => {
    appendLog('Conexión con el servidor backend perdida. Reconectando...', 'error');
    setTimeout(initSocket, 3000);
  };
}

// Log Append
function appendLog(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function appendOAuthConsole(message) {
  const line = document.createElement('div');
  line.innerText = message;
  oauthConsole.appendChild(line);
  oauthConsole.scrollTop = oauthConsole.scrollHeight;
}

// Format bytes to readable size
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0 || bytes === "0") return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Update Loader/Downloader State
function handleDownloadProgress(msg) {
  if (msg.status === 'downloading') {
    loaderOverlay.classList.remove('hidden');
    loaderTitle.innerText = 'Descargando Rclone';
    loaderDesc.innerText = msg.progress;
    
    // Simulate progression parsing
    if (msg.progress.includes('Downloading Rclone ZIP')) {
      loaderProgress.style.width = '30%';
    } else if (msg.progress.includes('Extracting')) {
      loaderProgress.style.width = '60%';
    } else if (msg.progress.includes('Moving')) {
      loaderProgress.style.width = '85%';
    }
  } else if (msg.status === 'ready') {
    loaderOverlay.classList.add('hidden');
    refreshData();
  } else if (msg.status === 'error') {
    loaderOverlay.classList.remove('hidden');
    loaderTitle.innerText = 'Error de Instalación';
    loaderDesc.innerText = msg.progress || 'No se pudo descargar Rclone automáticamente.';
    loaderProgress.style.backgroundColor = '#ff3e6c';
  }
}

// Update Header Indicators
function updateSystemStatus(status) {
  // Rclone Status
  if (status.rcloneStatus === 'checking') {
    statusRcloneText.innerText = 'Verificando...';
    statusRcloneIndicator.className = 'status-indicator warn';
  } else if (status.rcloneStatus === 'downloading') {
    statusRcloneText.innerText = 'Descargando...';
    statusRcloneIndicator.className = 'status-indicator warn';
    loaderOverlay.classList.remove('hidden');
    loaderTitle.innerText = 'Descargando Rclone';
  } else if (status.rcloneStatus === 'ready') {
    statusRcloneText.innerText = 'Listo (Local)';
    statusRcloneIndicator.className = 'status-indicator ready';
    loaderOverlay.classList.add('hidden');
  } else {
    statusRcloneText.innerText = 'Error';
    statusRcloneIndicator.className = 'status-indicator error';
  }

  // WinFsp Status
  isWinFspInstalled = status.winfspInstalled;
  if (isWinFspInstalled) {
    statusWinfspText.innerText = 'Detectado';
    statusWinfspIndicator.className = 'status-indicator ready';
    winfspAlertBanner.classList.add('hidden');
    selectMountMethod.value = 'winfsp';
    document.getElementById('group-mount-method').classList.remove('hidden');
  } else {
    statusWinfspText.innerText = 'No instalado';
    statusWinfspIndicator.className = 'status-indicator warn';
    winfspAlertBanner.classList.remove('hidden');
    selectMountMethod.value = 'webdav';
    // hide selection since WebDAV is forced
    document.getElementById('group-mount-method').classList.add('hidden');
  }

  // Mount Status
  updateMountStatus(status.mounted, status.mountConfig);

  // Cache Status
  if (status.cacheSize !== undefined) {
    statusCacheText.innerText = formatBytes(status.cacheSize);
    if (status.cacheSize > 0) {
      statusCacheIndicator.className = 'status-indicator ready';
    } else {
      statusCacheIndicator.className = 'status-indicator idle';
    }
  }

  // Transfer Status
  if (status.transferRunning !== undefined) {
    updateTransferStatus(status.transferRunning, status.transferStats);
  }
}

// Update Drive Mounting Controls
function updateMountStatus(mounted, config) {
  mountState.mounted = mounted;
  mountState.config = config;

  const inputVolumeName = document.getElementById('input-volume-name');

  if (mounted && config) {
    statusMountText.innerText = `Montado en ${config.letter}:`;
    statusMountIndicator.className = 'status-indicator ready';
    
    btnToggleMount.innerText = `Desmontar Unidad (${config.letter}:)`;
    btnToggleMount.className = 'btn btn-glowing unmount-mode';
    btnToggleMount.disabled = false;
    
    selectDriveLetter.disabled = true;
    selectMountMethod.disabled = true;
    if (inputVolumeName) {
      inputVolumeName.disabled = true;
      if (config.volumeName) {
        inputVolumeName.value = config.volumeName;
      }
    }
    btnClearCache.disabled = true;
  } else {
    statusMountText.innerText = 'Sin montar';
    statusMountIndicator.className = 'status-indicator idle';
    
    btnToggleMount.innerText = 'Montar Unidad';
    btnToggleMount.className = 'btn btn-glowing';
    
    // Enable only if union exists
    const hasUnion = drivesData.some(d => d.name === 'combined');
    btnToggleMount.disabled = !hasUnion;
    
    selectDriveLetter.disabled = false;
    selectMountMethod.disabled = false;
    if (inputVolumeName) {
      inputVolumeName.disabled = false;
    }
    btnClearCache.disabled = false;
  }
}

// Render transfer destination select options based on drivesData
function renderTransferDestOptions() {
  if (!selectTransferDest) return;
  const currentVal = selectTransferDest.value;
  selectTransferDest.innerHTML = '';
  
  // If union exists, add combined
  const hasUnion = drivesData.some(d => d.name === 'combined');
  if (hasUnion) {
    const opt = document.createElement('option');
    opt.value = 'combined';
    opt.innerText = 'Unidad Fusionada (combined)';
    selectTransferDest.appendChild(opt);
  }
  
  // Add other individual remotes
  drivesData.forEach(d => {
    if (d.name !== 'combined') {
      const opt = document.createElement('option');
      opt.value = d.name;
      opt.innerText = `${d.name} (${d.type})`;
      selectTransferDest.appendChild(opt);
    }
  });

  if (currentVal && selectTransferDest.querySelector(`option[value="${currentVal}"]`)) {
    selectTransferDest.value = currentVal;
  }
}

// Update Transfer Card controls and progress details
function updateTransferStatus(running, stats) {
  isTransferRunning = running;
  if (stats) activeTransferStats = stats;
  
  const hasAnyRemote = drivesData.length > 0;
  btnStartTransfer.disabled = running || !hasAnyRemote;

  if (running) {
    btnStartTransfer.classList.add('hidden');
    btnCancelTransfer.classList.remove('hidden');
    
    inputTransferSource.disabled = true;
    selectTransferDest.disabled = true;
    inputTransferSubfolder.disabled = true;
    btnModeCopy.disabled = true;
    btnModeSync.disabled = true;
    
    if (stats) {
      transferProgressContainer.classList.remove('hidden');
      transferProgressPercent.innerText = `${stats.progress}%`;
      transferProgressBarFill.style.width = `${stats.progress}%`;
      transferProgressSpeed.innerText = stats.speed;
      transferProgressSize.innerText = `${stats.transferred} / ${stats.total}`;
      transferProgressEta.innerText = stats.eta;
    }
  } else {
    btnStartTransfer.classList.remove('hidden');
    btnCancelTransfer.classList.add('hidden');
    
    inputTransferSource.disabled = false;
    selectTransferDest.disabled = false;
    inputTransferSubfolder.disabled = false;
    btnModeCopy.disabled = false;
    btnModeSync.disabled = false;
    
    transferProgressContainer.classList.add('hidden');
  }
}

// Fetch configured accounts & details
async function refreshData() {
  try {
    const res = await fetch('/api/drives');
    drivesData = await safeFetchJson(res);
    
    renderDrivesList();
    renderUnionSelectionList();
    updateUnionStatus();
    renderTransferDestOptions();
    updateTransferStatus(isTransferRunning, activeTransferStats);
    
    // Populate letters if empty
    if (selectDriveLetter.children.length === 0) {
      await refreshDriveLetters();
    }
  } catch (error) {
    appendLog(`Error cargando lista de cuentas: ${error.message}`, 'error');
  }
}

async function refreshDriveLetters() {
  try {
    const res = await fetch('/api/drive-letters');
    const letters = await res.json();
    
    selectDriveLetter.innerHTML = '';
    letters.forEach(letter => {
      const option = document.createElement('option');
      option.value = letter;
      option.innerText = `${letter}:`;
      selectDriveLetter.appendChild(option);
    });
    
    // Default select last one (usually X or Z)
    if (letters.length > 0) {
      selectDriveLetter.value = letters[0];
    }
  } catch (error) {
    appendLog(`Error cargando letras de unidad: ${error.message}`, 'error');
  }
}

// Render Drives Left Card
function renderDrivesList() {
  const cloudDrives = drivesData.filter(d => d.name !== 'combined');
  const unionDrive = drivesData.find(d => d.name === 'combined');

  if (drivesData.length === 0) {
    drivesContainer.innerHTML = `
      <div class="empty-state">
        <p>No hay cuentas de almacenamiento configuradas aún.</p>
        <p class="sub-text">Haz clic en "+ OneDrive" para añadir tu primera cuenta.</p>
      </div>
    `;
    return;
  }

  // Remove empty state if present
  const emptyState = drivesContainer.querySelector('.empty-state');
  if (emptyState) drivesContainer.innerHTML = '';

  // Render or update cloud remotes
  cloudDrives.forEach(drive => {
    let item = document.getElementById(`drive-item-${drive.name}`);
    if (!item) {
      item = document.createElement('div');
      item.className = 'drive-item';
      item.id = `drive-item-${drive.name}`;
      
      item.innerHTML = `
        <div class="drive-meta">
          <div class="drive-name-wrapper">
            <span class="drive-icon">☁️</span>
            <span class="drive-name">${drive.name}</span>
          </div>
          <div class="drive-actions">
            <button class="btn-icon-only btn-reconnect" title="Re-autorizar cuenta" onclick="reconnectDrive('${drive.name}')">🔄</button>
            <button class="btn-icon-only btn-delete" title="Eliminar cuenta" onclick="deleteDrive('${drive.name}')">🗑️</button>
          </div>
          <span class="drive-type">${drive.type}</span>
        </div>
        <div class="drive-size-container" id="space-${drive.name}">
          <div class="progress-track">
            <div class="progress-fill" style="width: 0%;"></div>
          </div>
          <div class="drive-size-text">
            <span>Calculando espacio...</span>
          </div>
        </div>
      `;
      const sep = drivesContainer.querySelector('.drive-separator');
      if (sep) {
        drivesContainer.insertBefore(item, sep);
      } else {
        drivesContainer.appendChild(item);
      }
    }
    loadDriveSpace(drive.name);
  });

  // Remove drive items that no longer exist
  const existingCloudItems = drivesContainer.querySelectorAll('.drive-item:not(.union-type)');
  existingCloudItems.forEach(el => {
    const dName = el.id.replace('drive-item-', '');
    if (!cloudDrives.some(d => d.name === dName)) {
      el.remove();
    }
  });

  // Render or update Union combined drive at the bottom
  let unionItem = document.getElementById('drive-item-combined');
  if (unionDrive) {
    if (!unionItem) {
      const separator = document.createElement('div');
      separator.className = 'drive-separator';
      separator.style.borderTop = '1px dashed var(--card-border)';
      separator.style.margin = '10px 0';
      drivesContainer.appendChild(separator);

      unionItem = document.createElement('div');
      unionItem.className = 'drive-item union-type';
      unionItem.id = `drive-item-combined`;
      
      unionItem.innerHTML = `
        <div class="drive-meta">
          <div class="drive-name-wrapper">
            <span class="drive-icon">📁</span>
            <span class="drive-name">Unidad Virtual Integrada (combined)</span>
          </div>
          <span class="drive-type">union</span>
        </div>
        <div class="drive-size-container" id="space-combined">
          <div class="progress-track">
            <div class="progress-fill" style="width: 0%;"></div>
          </div>
          <div class="drive-size-text">
            <span>Calculando espacio total...</span>
          </div>
        </div>
      `;
      drivesContainer.appendChild(unionItem);
    }
    loadDriveSpace('combined');
  } else {
    if (unionItem) {
      unionItem.remove();
      const sep = drivesContainer.querySelector('.drive-separator');
      if (sep) sep.remove();
    }
  }
}

// Fetch capacity details
async function loadDriveSpace(name) {
  const container = document.getElementById(`space-${name}`);
  if (!container) return;

  try {
    const res = await fetch(`/api/drives/space/${name}`);
    if (!res.ok) throw new Error('Space failed');
    const space = await res.json(); // { total, used, free }
    
    if (space && space.total) {
      const percentage = ((space.used / space.total) * 100).toFixed(1);
      const usedStr = formatBytes(space.used);
      const totalStr = formatBytes(space.total);
      
      container.querySelector('.progress-fill').style.width = `${percentage}%`;
      container.querySelector('.drive-size-text').innerHTML = `
        <span>${usedStr} usados de ${totalStr}</span>
        <span>${percentage}%</span>
      `;
    } else {
      container.querySelector('.drive-size-text').innerText = 'Espacio: Ilimitado / Desconocido';
    }
  } catch (error) {
    container.querySelector('.drive-size-text').innerText = 'Información de espacio no disponible';
  }
}

// Render Union checklist
function renderUnionSelectionList() {
  unionSelectList.innerHTML = '';
  
  const cloudDrives = drivesData.filter(d => d.name !== 'combined');
  
  if (cloudDrives.length === 0) {
    unionSelectList.innerHTML = `
      <p class="empty-state-small">Conecta al menos dos cuentas en la izquierda para fusionarlas.</p>
    `;
    btnCreateUnion.disabled = true;
    return;
  }

  // Check if union already exists and what remotes are in it
  const unionDrive = drivesData.find(d => d.name === 'combined');
  let currentUpstreams = [];
  if (unionDrive && unionDrive.upstreams) {
    // Upstreams are space separated e.g. "drive1: drive2:"
    currentUpstreams = unionDrive.upstreams.split(' ').map(u => u.replace(':', '').trim()).filter(Boolean);
  }

  cloudDrives.forEach(drive => {
    const label = document.createElement('label');
    label.className = 'union-checkbox-item';
    
    // Auto check if it was already in the union
    const isChecked = currentUpstreams.includes(drive.name) || currentUpstreams.length === 0;

    label.innerHTML = `
      <input type="checkbox" value="${drive.name}" ${isChecked ? 'checked' : ''} class="union-checkbox">
      <span>${drive.name}</span>
    `;
    
    unionSelectList.appendChild(label);
  });

  // Bind checkbox changes
  const checkboxes = document.querySelectorAll('.union-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', checkUnionButtonState);
  });

  checkUnionButtonState();
}

function checkUnionButtonState() {
  const checked = document.querySelectorAll('.union-checkbox:checked');
  btnCreateUnion.disabled = checked.length < 2;
}

// Update Union Badge status text
function updateUnionStatus() {
  const unionDrive = drivesData.find(d => d.name === 'combined');
  
  if (unionDrive && unionDrive.upstreams) {
    const count = unionDrive.upstreams.split(' ').filter(Boolean).length;
    unionStatusBadge.innerText = `Listo (${count} cuentas fusionadas)`;
    unionStatusBadge.className = 'badge active';
    
    // Enable mount button if not already mounting/mounted
    if (!mountState.mounted) {
      btnToggleMount.disabled = false;
    }
  } else {
    unionStatusBadge.innerText = 'No configurado';
    unionStatusBadge.className = 'badge';
    btnToggleMount.disabled = true;
  }
}

// UI Event Handlers
btnAddOneDrive.addEventListener('click', () => {
  inputDriveName.value = '';
  modalAdd.classList.remove('hidden');
  inputDriveName.focus();
});

btnModalCancel.addEventListener('click', () => {
  modalAdd.classList.add('hidden');
});

btnModalConfirm.addEventListener('click', async () => {
  const name = inputDriveName.value.trim();
  if (!name) return alert('Por favor introduce un nombre.');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return alert('Nombre inválido. Use solo letras, números y guiones bajos.');
  }

  modalAdd.classList.add('hidden');
  
  // Open oauth modal
  modalOauth.classList.remove('hidden');
  oauthConsole.innerHTML = '<div class="terminal-line system">Iniciando proceso en Rclone...</div>';

  try {
    const res = await fetch('/api/drives/add-onedrive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ocurrió un error al configurar la cuenta.');
      modalOauth.classList.add('hidden');
    }
  } catch (error) {
    alert('Error al iniciar la configuración en el servidor.');
    modalOauth.classList.add('hidden');
  }
});

btnManualConfig.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/config/manual', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      appendLog('Consola de configuración de Rclone abierta en tu escritorio.', 'success');
      alert('Se ha abierto una ventana de comando en tu PC. Realiza los pasos que desees de rclone, cierra la consola al finalizar, y luego pulsa Aceptar para recargar el panel de control.');
      refreshData();
    } else {
      alert(`Error al abrir la consola: ${data.error}`);
    }
  } catch (error) {
    alert('Error al comunicar con el backend.');
  }
});

btnCreateUnion.addEventListener('click', async () => {
  const checked = document.querySelectorAll('.union-checkbox:checked');
  const remotes = Array.from(checked).map(cb => cb.value);
  
  btnCreateUnion.disabled = true;
  btnCreateUnion.innerText = 'Integrando...';

  try {
    const res = await fetch('/api/union/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'combined', remotes })
    });
    
    const data = await res.json();
    if (res.ok) {
      appendLog('Disco virtual unificado creado correctamente.', 'success');
      refreshData();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    alert('Error al crear la fusión en el servidor.');
  } finally {
    btnCreateUnion.innerText = 'Integrar en Disco Virtual';
    checkUnionButtonState();
  }
});

btnToggleMount.addEventListener('click', async () => {
  if (mountState.mounted) {
    // Unmount
    btnToggleMount.disabled = true;
    btnToggleMount.innerText = 'Desmontando...';
    try {
      const res = await fetch('/api/unmount', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(`Error al desmontar: ${data.error}`);
      }
    } catch (e) {
      alert('Error en el servidor al desmontar.');
    } finally {
      // socket update will handle states
    }
  } else {
    // Mount
    const letter = selectDriveLetter.value;
    const method = selectMountMethod.value;
    const volumeName = document.getElementById('input-volume-name').value.trim() || 'Nubes Unidas';
    
    btnToggleMount.disabled = true;
    btnToggleMount.innerText = 'Montando...';
    
    try {
      const res = await fetch('/api/mount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remote: 'combined', letter, method, volumeName })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Error al iniciar montaje: ${data.error}`);
        btnToggleMount.innerText = 'Montar Unidad';
        btnToggleMount.disabled = false;
      }
    } catch (e) {
      alert('Error en el servidor al iniciar montaje.');
      btnToggleMount.innerText = 'Montar Unidad';
      btnToggleMount.disabled = false;
    }
  }
});

btnClearLogs.addEventListener('click', () => {
  terminal.innerHTML = '<div class="terminal-line system">--- Consola de actividad limpiada ---</div>';
});

btnOauthCancel.addEventListener('click', async () => {
  btnOauthCancel.disabled = true;
  btnOauthCancel.innerText = 'Cancelando...';
  try {
    const res = await fetch('/api/drives/cancel-setup', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      appendLog('Proceso de configuración cancelado por el usuario.', 'warn');
      modalOauth.classList.add('hidden');
    } else {
      alert(`Error al cancelar: ${data.error}`);
    }
  } catch (e) {
    alert('Error al comunicar la cancelación al servidor.');
  } finally {
    btnOauthCancel.disabled = false;
    btnOauthCancel.innerText = 'Cancelar Proceso';
  }
});

// Reconnect/Re-authorize account
async function reconnectDrive(name) {
  if (!confirm(`¿Estás seguro de que deseas re-autorizar la cuenta "${name}"? Se abrirá tu navegador para iniciar sesión.`)) return;

  modalOauth.classList.remove('hidden');
  oauthConsole.innerHTML = `<div class="terminal-line system">Iniciando re-autorización para ${name} en Rclone...</div>`;

  try {
    const res = await fetch('/api/drives/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ocurrió un error al iniciar la re-autorización.');
      modalOauth.classList.add('hidden');
    }
  } catch (error) {
    alert('Error al iniciar la re-autorización en el servidor.');
    modalOauth.classList.add('hidden');
  }
}

// Delete account
async function deleteDrive(name) {
  if (!confirm(`¿Estás seguro de que deseas eliminar la cuenta "${name}"? Esta acción no borrará tus archivos en OneDrive, pero sí quitará la conexión en esta app.`)) return;

  try {
    const res = await fetch('/api/drives/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await res.json();
    if (res.ok) {
      appendLog(`Cuenta "${name}" eliminada correctamente.`, 'success');
      refreshData();
    } else {
      alert(`Error al eliminar: ${data.error}`);
    }
  } catch (error) {
    alert('Error al comunicar la eliminación al servidor.');
  }
}

// Bind to window for dynamic HTML scope
window.reconnectDrive = reconnectDrive;
window.deleteDrive = deleteDrive;

const chkAutoStart = document.getElementById('chk-auto-start');

async function initStartupStatus() {
  try {
    const res = await fetch('/api/startup/status');
    const data = await res.json();
    if (data.supported) {
      chkAutoStart.checked = data.enabled;
    } else {
      chkAutoStart.parentElement.style.display = 'none';
    }
  } catch (e) {
    console.error('Error checking startup status:', e);
  }
}

chkAutoStart.addEventListener('change', async () => {
  const enabled = chkAutoStart.checked;
  chkAutoStart.disabled = true;
  try {
    const res = await fetch('/api/startup/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.error}`);
      chkAutoStart.checked = !enabled;
    } else {
      appendLog(`Inicio automático ${enabled ? 'habilitado' : 'deshabilitado'}.`, 'success');
    }
  } catch (e) {
    alert('Error de red al configurar inicio automático.');
    chkAutoStart.checked = !enabled;
  } finally {
    chkAutoStart.disabled = false;
  }
});

btnClearCache.addEventListener('click', async () => {
  if (!confirm('¿Estás seguro de que deseas vaciar el caché local temporal? Esto eliminará todos los archivos locales descargados temporalmente para liberar espacio en disco. Tus archivos en la nube no se verán afectados.')) return;

  btnClearCache.disabled = true;
  btnClearCache.innerText = 'Vaciando...';
  try {
    const res = await fetch('/api/cache/clear', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      appendLog('Caché local de Rclone vaciado con éxito.', 'success');
      statusCacheText.innerText = '0 Bytes';
      statusCacheIndicator.className = 'status-indicator idle';
      alert('Caché local vaciado correctamente.');
    } else {
      alert(`Error al vaciar el caché: ${data.error}`);
    }
  } catch (e) {
    alert('Error al comunicar la orden de limpieza al servidor.');
  } finally {
    btnClearCache.disabled = false;
    btnClearCache.innerText = 'Vaciar';
  }
});

// Transfer Mode Toggles
btnModeCopy.addEventListener('click', () => {
  activeTransferMode = 'copy';
  btnModeCopy.classList.add('active');
  btnModeSync.classList.remove('active');
});

btnModeSync.addEventListener('click', () => {
  if (confirm('ADVERTENCIA: La sincronización (Sync) hará que la carpeta destino sea idéntica al origen. Si hay archivos en la nube de destino que no están en tu carpeta local de origen, SE ELIMINARÁN permanentemente.\n\n¿Estás seguro de que deseas seleccionar el modo Sincronizar?')) {
    activeTransferMode = 'sync';
    btnModeSync.classList.add('active');
    btnModeCopy.classList.remove('active');
  }
});

// Start Transfer Button click
btnStartTransfer.addEventListener('click', async () => {
  const source = inputTransferSource.value.trim();
  const destination = selectTransferDest.value;
  const subfolder = inputTransferSubfolder.value.trim();

  if (!source) {
    alert('Por favor, introduce la ruta de origen local.');
    return;
  }

  btnStartTransfer.disabled = true;
  btnStartTransfer.innerText = 'Iniciando...';

  try {
    const res = await fetch('/api/transfer/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: activeTransferMode, source, destination, subfolder })
    });
    const data = await safeFetchJson(res);
    if (!res.ok) {
      alert(`Error al iniciar transferencia: ${data.error}`);
      btnStartTransfer.disabled = false;
      btnStartTransfer.innerText = 'Iniciar Transferencia';
    }
  } catch (e) {
    alert(e.message);
    btnStartTransfer.disabled = false;
    btnStartTransfer.innerText = 'Iniciar Transferencia';
  }
});

// Cancel Transfer Button click
btnCancelTransfer.addEventListener('click', async () => {
  if (!confirm('¿Estás seguro de que deseas cancelar la transferencia en curso? El proceso se detendrá inmediatamente.')) return;

  btnCancelTransfer.disabled = true;
  btnCancelTransfer.innerText = 'Cancelando...';
  try {
    const res = await fetch('/api/transfer/cancel', { method: 'POST' });
    const data = await safeFetchJson(res);
    if (!res.ok) {
      alert(`Error al cancelar transferencia: ${data.error}`);
      btnCancelTransfer.disabled = false;
      btnCancelTransfer.innerText = 'Cancelar Transferencia';
    }
  } catch (e) {
    alert(e.message);
    btnCancelTransfer.disabled = false;
    btnCancelTransfer.innerText = 'Cancelar Transferencia';
  }
});

// Open Visual File Explorer Window
btnOpenExplorer.addEventListener('click', () => {
  window.open('/explorer.html', 'RcloneExplorer', 'width=1350,height=880');
});

// Shutdown Application Button click
btnAppShutdown.addEventListener('click', async () => {
  if (!confirm('¿Estás seguro de que deseas apagar la aplicación por completo?\n\nEsto desmontará el disco virtual, detendrá cualquier transferencia o configuración activa y cerrará el servidor local.')) return;

  btnAppShutdown.disabled = true;
  btnAppShutdown.innerText = 'Apagando...';
  appendLog('Apagando servidor y deteniendo todos los procesos...', 'warn');

  try {
    const res = await fetch('/api/shutdown', { method: 'POST' });
    if (res.ok) {
      loaderOverlay.classList.remove('hidden');
      document.getElementById('loader-title').innerText = 'Aplicación Apagada';
      document.getElementById('loader-desc').innerText = 'El servidor local se ha detenido con éxito. Ya puedes cerrar esta ventana.';
      const progressBarContainer = document.getElementById('loader-progress').parentElement;
      if (progressBarContainer) progressBarContainer.style.display = 'none';
      
      setTimeout(() => {
        window.close();
      }, 1500);
    } else {
      alert('Error al apagar el servidor.');
      btnAppShutdown.disabled = false;
      btnAppShutdown.innerText = 'Apagar Aplicación';
    }
  } catch (e) {
    // Connection lost = server went down successfully
    loaderOverlay.classList.remove('hidden');
    document.getElementById('loader-title').innerText = 'Aplicación Apagada';
    document.getElementById('loader-desc').innerText = 'El servidor local se ha detenido con éxito. Ya puedes cerrar esta ventana.';
    const progressBarContainer = document.getElementById('loader-progress').parentElement;
    if (progressBarContainer) progressBarContainer.style.display = 'none';
    setTimeout(() => {
      window.close();
    }, 1500);
  }
});

// App Startup
initSocket();
refreshData();
initStartupStatus();
// Poll drives list periodically to update metrics and check changes
setInterval(refreshData, 30000);
