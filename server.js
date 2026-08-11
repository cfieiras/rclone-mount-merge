const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const open = require('open');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const BIN_DIR = path.join(__dirname, 'bin');
const RCLONE_EXE = path.join(BIN_DIR, 'rclone.exe');
const RCLONE_CONF = path.join(BIN_DIR, 'rclone.conf');

// State variables
let rcloneStatus = 'checking'; // 'checking', 'downloading', 'ready', 'error'
let downloadProgress = '';
let activeMountProcess = null;
let activeMountConfig = null; // { remote, letter, type }
let activeConfigProcess = null;
let activeTransferProcess = null;
let activeTransferStats = null;

// Ensure directories exist
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}
if (!fs.existsSync(RCLONE_CONF)) {
  fs.writeFileSync(RCLONE_CONF, '');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Broadcast to WebSocket clients
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Log helper
function logToUI(message, type = 'info') {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString(),
    message,
    type
  };
  console.log(`[${type.toUpperCase()}] ${message}`);
  broadcast({ type: 'log', data: logEntry });
}

// Download Rclone using PowerShell
function downloadRclone() {
  rcloneStatus = 'downloading';
  downloadProgress = 'Downloading Rclone ZIP archive from official server...';
  logToUI(downloadProgress);

  const psCommand = `
    $ErrorActionPreference = 'Stop'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $url = 'https://downloads.rclone.org/rclone-current-windows-amd64.zip'
    $zipFile = Join-Path '${BIN_DIR}' 'rclone.zip'
    $extractDir = Join-Path '${BIN_DIR}' 'rclone-temp'
    
    Write-Output "Downloading $url to $zipFile"
    Invoke-WebRequest -Uri $url -OutFile $zipFile
    
    Write-Output "Extracting archive to $extractDir"
    Expand-Archive -Path $zipFile -DestinationPath $extractDir -Force
    
    Write-Output "Moving rclone.exe"
    $exe = Get-ChildItem -Path $extractDir -Filter 'rclone.exe' -Recurse | Select-Object -First 1
    if ($exe) {
        Move-Item -Path $exe.FullName -Destination '${RCLONE_EXE}' -Force
    } else {
        throw "rclone.exe not found in extracted files"
    }
    
    Write-Output "Cleaning up temp files"
    Remove-Item -Path $extractDir -Recurse -Force
    Remove-Item -Path $zipFile -Force
    Write-Output "Done"
  `;

  const child = spawn('powershell', ['-NoProfile', '-Command', psCommand]);

  child.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      downloadProgress = text;
      logToUI(text);
      broadcast({ type: 'download_status', status: 'downloading', progress: text });
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      logToUI(`PowerShell Error: ${text}`, 'error');
    }
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(RCLONE_EXE)) {
      rcloneStatus = 'ready';
      logToUI('Rclone is ready to use!', 'success');
      broadcast({ type: 'download_status', status: 'ready' });
    } else {
      rcloneStatus = 'error';
      logToUI(`Failed to download and extract Rclone (Code: ${code})`, 'error');
      broadcast({ type: 'download_status', status: 'error', progress: 'Download failed. Please check backend console logs.' });
    }
  });
}

// Check Rclone on startup
function checkRclone() {
  logToUI('Checking Rclone binary...');
  if (fs.existsSync(RCLONE_EXE)) {
    rcloneStatus = 'ready';
    logToUI('Rclone binary found locally in bin/rclone.exe', 'success');
  } else {
    logToUI('Rclone binary not found. Initiating automatic download...', 'warn');
    downloadRclone();
  }
}

// Get configured remotes
function getRemotes() {
  if (rcloneStatus !== 'ready') return {};
  try {
    const result = execSync(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" config dump`, { encoding: 'utf8' });
    return JSON.parse(result);
  } catch (error) {
    logToUI(`Error reading rclone configurations: ${error.message}`, 'error');
    return {};
  }
}

// Get free drive letters on Windows
function getAvailableDriveLetters(callback) {
  exec('powershell -NoProfile -Command "[System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name[0] }"', (err, stdout) => {
    if (err) {
      logToUI(`Error listing drive letters: ${err.message}`, 'error');
      return callback(['X', 'Y', 'Z', 'W', 'V', 'U', 'T', 'S', 'R', 'Q']); // Fallback defaults
    }
    const usedLetters = stdout
      .split('\r\n')
      .map(line => line.trim().toUpperCase())
      .filter(line => line.length === 1);
    
    const allLetters = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const freeLetters = allLetters.filter(l => !usedLetters.includes(l));
    callback(freeLetters);
  });
}

// Check WinFsp
function checkWinFsp() {
  const winfspPath = 'C:\\Program Files (x86)\\WinFsp';
  return fs.existsSync(winfspPath);
}

// API Endpoints
// Get directory size recursively
function getDirectorySize(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (let i = 0; i < files.length; i++) {
      const filePath = path.join(dirPath, files[i]);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (e) {
    // Ignore folder read errors (like locked files)
  }
  return size;
}

function getCacheSize() {
  const cachePath = path.join(BIN_DIR, 'cache');
  return getDirectorySize(cachePath);
}

// API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    rcloneStatus,
    downloadProgress,
    winfspInstalled: checkWinFsp(),
    mounted: activeMountProcess !== null,
    mountConfig: activeMountConfig,
    cacheSize: getCacheSize(),
    transferRunning: activeTransferProcess !== null,
    transferStats: activeTransferStats
  });
});

app.post('/api/cache/clear', (req, res) => {
  if (activeMountProcess) {
    return res.status(400).json({ error: 'No se puede limpiar el caché mientras el disco esté montado.' });
  }
  
  logToUI('Clearing local VFS cache folder...');
  try {
    const cachePath = path.join(BIN_DIR, 'cache');
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
    }
    logToUI('Local VFS cache cleared successfully!', 'success');
    res.json({ message: 'Caché local limpiado con éxito.' });
  } catch (error) {
    logToUI(`Error clearing VFS cache: ${error.message}`, 'error');
    res.status(500).json({ error: 'No se pudo limpiar la carpeta de caché. Algunos archivos podrían estar bloqueados por Windows.' });
  }
});

// Windows Startup Shortcut manager
function getStartupShortcutPath() {
  if (process.platform !== 'win32') return null;
  const startupFolder = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  return path.join(startupFolder, 'RcloneCloudMerger.lnk');
}

app.get('/api/startup/status', (req, res) => {
  const shortcutPath = getStartupShortcutPath();
  if (!shortcutPath) {
    return res.json({ enabled: false, supported: false });
  }
  const exists = fs.existsSync(shortcutPath);
  res.json({ enabled: exists, supported: true });
});

app.post('/api/startup/toggle', (req, res) => {
  const { enabled } = req.body;
  const shortcutPath = getStartupShortcutPath();
  
  if (!shortcutPath) {
    return res.status(400).json({ error: 'Auto-inicio no soportado en este sistema operativo.' });
  }

  if (enabled) {
    logToUI('Enabling auto-start with Windows...');
    const vbsPath = path.join(__dirname, 'launch.vbs');
    const workingDir = __dirname;

    const escapedShortcutPath = shortcutPath.replace(/'/g, "''");
    const escapedVbsPath = vbsPath.replace(/'/g, "''");
    const escapedWorkingDir = workingDir.replace(/'/g, "''");

    const psCommand = `$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('${escapedShortcutPath}'); $Shortcut.TargetPath = '${escapedVbsPath}'; $Shortcut.WorkingDirectory = '${escapedWorkingDir}'; $Shortcut.Save();`;

    exec(`powershell -NoProfile -Command "${psCommand}"`, (err) => {
      if (err) {
        logToUI(`Error setting auto-start: ${err.message}`, 'error');
        return res.status(500).json({ error: 'No se pudo configurar el auto-inicio.' });
      }
      logToUI('Auto-start enabled successfully!', 'success');
      res.json({ enabled: true });
    });
  } else {
    logToUI('Disabling auto-start with Windows...');
    try {
      if (fs.existsSync(shortcutPath)) {
        fs.unlinkSync(shortcutPath);
      }
      logToUI('Auto-start disabled successfully!', 'success');
      res.json({ enabled: false });
    } catch (e) {
      logToUI(`Error removing auto-start shortcut: ${e.message}`, 'error');
      res.status(500).json({ error: 'No se pudo desactivar el auto-inicio.' });
    }
  }
});


app.get('/api/drives', (req, res) => {
  const remotes = getRemotes();
  const list = Object.keys(remotes).map(name => {
    return {
      name,
      type: remotes[name].type,
      upstreams: remotes[name].upstreams || null
    };
  });
  res.json(list);
});

app.get('/api/drive-letters', (req, res) => {
  getAvailableDriveLetters((letters) => {
    res.json(letters);
  });
});

// Get space metrics using `rclone about`
app.get('/api/drives/space/:name', (req, res) => {
  const name = req.params.name;
  exec(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" about "${name}:" --json`, (err, stdout) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    try {
      const space = JSON.parse(stdout);
      res.json(space); // { total, used, free } in bytes
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse storage capacity data' });
    }
  });
});

// Express Setup OneDrive
app.post('/api/drives/add-onedrive', (req, res) => {
  const { name } = req.body;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Nombre de cuenta inválido. Use solo letras, números, guiones y guiones bajos.' });
  }

  const remotes = getRemotes();
  if (remotes[name]) {
    return res.status(400).json({ error: 'Ya existe una cuenta configurada con ese nombre.' });
  }

  logToUI(`Starting automated OneDrive setup for: ${name}...`);
  
  // Spawn the config create command
  const child = spawn(RCLONE_EXE, [
    '--config', RCLONE_CONF,
    'config', 'create', name, 'onedrive'
  ]);

  activeConfigProcess = child;
  res.json({ status: 'started', message: 'Iniciando inicio de sesión en el navegador...' });

  let buffer = '';

  child.stdout.on('data', (data) => {
    const text = data.toString();
    buffer += text;
    logToUI(`[RCLONE SETUP] ${text.trim()}`);

    // Auto-respond to known prompts
    if (buffer.includes('Choose national cloud region')) {
      logToUI('Setup: Selecting Global region');
      child.stdin.write('1\n');
      buffer = '';
    } else if (buffer.includes('Use web browser to automatically authenticate')) {
      logToUI('Setup: Initiating Browser OAuth authorization');
      child.stdin.write('y\n');
      buffer = '';
    } else if (buffer.includes('Choose drive_id') || buffer.includes('Chose drive to write')) {
      // Look for Option "OneDrive (personal)" and parse its index dynamically
      const match = buffer.match(/(\d+)\s*\/\s*OneDrive\s*\(personal\)/i);
      const option = match ? match[1] : '1';
      logToUI(`Setup: Auto-selecting OneDrive drive option: ${option}`);
      child.stdin.write(`${option}\n`);
      buffer = '';
    } else if (buffer.includes('Found drive') && buffer.includes('Do you want to use it?')) {
      logToUI('Setup: Confirming selected drive');
      child.stdin.write('y\n');
      buffer = '';
    } else if (buffer.includes('Yes this is OK (default)')) {
      logToUI('Setup: Saving configuration');
      child.stdin.write('y\n');
      buffer = '';
    }

    // Auto-detect errors and terminate
    if (buffer.includes('HTTP error 400') || buffer.includes('HTTP error 403') || buffer.includes('accessDenied') || buffer.includes('invalidRequest')) {
      logToUI('Auto-detected OneDrive API authorization error. Terminating setup process...', 'error');
      child.kill('SIGKILL');
      buffer = '';
      return;
    }
  });

  child.stderr.on('data', (data) => {
    logToUI(`[RCLONE SETUP ERROR] ${data.toString().trim()}`, 'error');
  });

  child.on('close', (code) => {
    logToUI(`OneDrive setup process exited with code ${code}`);
    activeConfigProcess = null;
    broadcast({ type: 'setup_complete', success: code === 0, name });
  });
});

// Reconnect/Re-authorize OneDrive Account (Modify)
app.post('/api/drives/reconnect', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nombre de cuenta requerido.' });
  }

  logToUI(`Starting automated OneDrive reconnection (re-authorization) for: ${name}...`);

  // Spawn config reconnect remote:
  const child = spawn(RCLONE_EXE, [
    '--config', RCLONE_CONF,
    'config', 'reconnect', `${name}:`
  ]);

  activeConfigProcess = child;
  res.json({ status: 'started', message: 'Iniciando re-autorización en el navegador...' });

  let buffer = '';

  child.stdout.on('data', (data) => {
    const text = data.toString();
    buffer += text;
    logToUI(`[RCLONE RECONNECT] ${text.trim()}`);

    // Auto-respond to known prompts (similar to create)
    if (buffer.includes('Use web browser to automatically authenticate')) {
      logToUI('Reconnect: Initiating Browser OAuth authorization');
      child.stdin.write('y\n');
      buffer = '';
    } else if (buffer.includes('Choose drive_id') || buffer.includes('Chose drive to write')) {
      // Look for Option "OneDrive (personal)" and parse its index dynamically
      const match = buffer.match(/(\d+)\s*\/\s*OneDrive\s*\(personal\)/i);
      const option = match ? match[1] : '1';
      logToUI(`Reconnect: Auto-selecting OneDrive drive option: ${option}`);
      child.stdin.write(`${option}\n`);
      buffer = '';
    } else if (buffer.includes('Found drive') && buffer.includes('Do you want to use it?')) {
      logToUI('Reconnect: Confirming selected drive');
      child.stdin.write('y\n');
      buffer = '';
    } else if (buffer.includes('Yes this is OK (default)')) {
      logToUI('Reconnect: Saving configuration');
      child.stdin.write('y\n');
      buffer = '';
    }

    // Auto-detect errors and terminate
    if (buffer.includes('HTTP error 400') || buffer.includes('HTTP error 403') || buffer.includes('accessDenied') || buffer.includes('invalidRequest')) {
      logToUI('Auto-detected OneDrive API authorization error during reconnect. Terminating...', 'error');
      child.kill('SIGKILL');
      buffer = '';
      return;
    }
  });

  child.stderr.on('data', (data) => {
    logToUI(`[RCLONE RECONNECT ERROR] ${data.toString().trim()}`, 'error');
  });

  child.on('close', (code) => {
    logToUI(`OneDrive reconnection process exited with code ${code}`);
    activeConfigProcess = null;
    broadcast({ type: 'setup_complete', success: code === 0, name });
  });
});

// Delete configured drive
app.post('/api/drives/delete', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nombre de cuenta requerido.' });
  }

  if (activeMountProcess && activeMountConfig && activeMountConfig.remote === 'combined') {
    return res.status(400).json({ error: 'Desmonte el disco virtual unificado antes de eliminar cualquiera de sus cuentas constitutivas.' });
  }

  logToUI(`Deleting remote configuration for: ${name}...`);

  try {
    // Delete the remote
    execSync(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" config delete "${name}"`);

    // Synchronize Union configuration if combined exists
    const remotes = getRemotes();
    const unionDrive = remotes['combined'];
    if (unionDrive && unionDrive.upstreams) {
      let upstreams = unionDrive.upstreams.split(' ').map(u => u.replace(':', '').trim()).filter(Boolean);
      if (upstreams.includes(name)) {
        logToUI(`Removing deleted remote "${name}" from combined union upstreams...`);
        upstreams = upstreams.filter(u => u !== name);
        if (upstreams.length >= 2) {
          const newUpstreams = upstreams.map(r => `${r}:`).join(' ');
          execSync(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" config create combined union upstreams "${newUpstreams}" action_policy epall create_policy epmfs search_policy ff`);
          logToUI('Updated combined union with remaining upstreams.', 'success');
        } else {
          execSync(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" config delete combined`);
          logToUI('Deleted combined union since less than 2 upstreams remain.', 'warn');
        }
      }
    }

    logToUI(`Remote configuration "${name}" deleted successfully!`, 'success');
    res.json({ message: 'Cuenta eliminada con éxito.' });
  } catch (error) {
    logToUI(`Error deleting remote: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Cancel active setup
app.post('/api/drives/cancel-setup', (req, res) => {
  if (activeConfigProcess) {
    logToUI('Cancelling active OneDrive configuration process...');
    activeConfigProcess.kill('SIGTERM'); // Kill the child process cleanly
    activeConfigProcess = null;
    return res.json({ message: 'Proceso de configuración cancelado con éxito.' });
  }
  res.status(400).json({ error: 'No hay ningún proceso de configuración activo.' });
});


// Launch manual config terminal
app.post('/api/config/manual', (req, res) => {
  logToUI('Opening native command prompt for manual configuration...');
  // start cmd.exe and run rclone config in it
  const cmd = `start cmd.exe /k ""${RCLONE_EXE}" --config "${RCLONE_CONF}" config"`;
  exec(cmd, (err) => {
    if (err) {
      logToUI(`Failed to open console: ${err.message}`, 'error');
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Consola abierta' });
  });
});

// Create Union remote
app.post('/api/union/create', (req, res) => {
  const { name, remotes } = req.body; // remotes is array of strings: ['drive1', 'drive2']
  if (!name || !remotes || remotes.length < 2) {
    return res.status(400).json({ error: 'Seleccione al menos 2 cuentas para integrarlas.' });
  }

  logToUI(`Creating Union remote "${name}" combining: ${remotes.join(', ')}`);
  
  // Format upstreams like "drive1: drive2:"
  const upstreams = remotes.map(r => `${r}:`).join(' ');

  try {
    // Delete existing combined remote if it exists to clean up
    try {
      execSync(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" config delete "${name}"`);
    } catch (e) {
      // Ignore if it didn't exist
    }

    // Create the union remote
    execSync(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" config create "${name}" union upstreams "${upstreams}" action_policy epall create_policy epmfs search_policy ff`);
    
    logToUI(`Union remote "${name}" created successfully!`, 'success');
    res.json({ message: 'Disco virtual unificado creado con éxito.' });
  } catch (error) {
    logToUI(`Error creating union remote: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

function performMount(remote, letter, method, volumeName = 'Nubes Unidas') {
  if (activeMountProcess) return;

  const useWebDAV = method === 'webdav' || !checkWinFsp();
  logToUI(`Mounting "${remote}" as drive "${letter}:" using ${useWebDAV ? 'WebDAV fallback' : 'WinFsp native mount'}...`);

  // Save mount configuration for persistence across reboots
  try {
    fs.writeFileSync(path.join(BIN_DIR, 'mount_config.json'), JSON.stringify({ remote, letter, method, volumeName, autoMount: true }));
  } catch (e) {
    logToUI(`Error saving mount configuration: ${e.message}`, 'error');
  }

  if (useWebDAV) {
    // Start WebDAV server
    const port = 8080;
    const processArgs = [
      '--config', RCLONE_CONF,
      'serve', 'webdav', `${remote}:`,
      '--addr', `127.0.0.1:${port}`,
      '--vfs-cache-mode', 'full',
      '--onedrive-chunk-size', '20M',
      '--buffer-size', '32M',
      '--cache-dir', path.join(BIN_DIR, 'cache'),
      '--exclude', 'Almacén personal/**',
      '--exclude', 'Almacen personal/**',
      '--exclude', 'Personal Vault/**'
    ];
    
    const child = spawn(RCLONE_EXE, processArgs);
    activeMountProcess = child;
    activeMountConfig = { remote, letter, type: 'webdav', volumeName };

    child.stdout.on('data', (data) => {
      logToUI(`[WEBDAV SERVER] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      logToUI(`[WEBDAV SERVER LOG] ${data.toString().trim()}`);
    });

    // Wait 2 seconds for WebDAV to spin up, then map the drive
    setTimeout(() => {
      logToUI(`Mapping Windows Network Drive ${letter}: to http://127.0.0.1:${port}/...`);
      exec(`net use ${letter}: http://127.0.0.1:${port}/ /persistent:no`, (err, stdout, stderr) => {
        if (err) {
          logToUI(`Windows Map Error: ${stderr || err.message}`, 'error');
          // cleanup
          child.kill('SIGTERM');
          activeMountProcess = null;
          activeMountConfig = null;
          return broadcast({ type: 'mount_failed', error: 'No se pudo mapear la unidad de red en Windows. Verifica el servicio WebClient.' });
        }
        logToUI(`Successfully mapped network drive ${letter}:!`, 'success');
        broadcast({ type: 'mount_status', mounted: true, config: activeMountConfig });

        // Rename the WebDAV mapped network drive dynamically
        const cleanedVolName = volumeName.replace(/[^a-zA-Z0-9_\-\s]/g, '');
        const renameCmd = `powershell -NoProfile -Command "(New-Object -ComObject Shell.Application).NameSpace('${letter}:\\\\').Self.Name = '${cleanedVolName}'"`;
        exec(renameCmd, (renameErr) => {
          if (renameErr) {
            logToUI(`Warning: Could not rename drive to "${cleanedVolName}": ${renameErr.message}`, 'warn');
          } else {
            logToUI(`Network drive renamed to "${cleanedVolName}" successfully!`, 'success');
          }
        });
      });
    }, 2000);

    child.on('close', (code) => {
      logToUI(`WebDAV Server exited with code ${code}`);
      activeMountProcess = null;
      activeMountConfig = null;
      broadcast({ type: 'mount_status', mounted: false });
      checkAutoShutdown();
    });

  } else {
    // Start WinFsp native mount
    const processArgs = [
      '--config', RCLONE_CONF,
      'mount', `${remote}:`, `${letter}:`,
      '--vfs-cache-mode', 'full',
      '--volname', volumeName,
      '--onedrive-chunk-size', '20M',
      '--buffer-size', '32M',
      '--cache-dir', path.join(BIN_DIR, 'cache'),
      '--exclude', 'Almacén personal/**',
      '--exclude', 'Almacen personal/**',
      '--exclude', 'Personal Vault/**'
    ];

    const child = spawn(RCLONE_EXE, processArgs);
    activeMountProcess = child;
    activeMountConfig = { remote, letter, type: 'winfsp', volumeName };

    let isMounted = false;

    child.stdout.on('data', (data) => {
      const text = data.toString().trim();
      logToUI(`[MOUNT] ${text}`);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      logToUI(`[MOUNT LOG] ${text}`);
      
      // Look for confirmation that it has mounted
      if (text.includes('The service rclone has been started') || text.includes('Mounting on')) {
        isMounted = true;
        logToUI(`Successfully mounted drive ${letter}: using WinFsp!`, 'success');
        broadcast({ type: 'mount_status', mounted: true, config: activeMountConfig });
      }
    });

    // Fallback detection: if it doesn't crash in 3 seconds, assume mounted successfully
    setTimeout(() => {
      if (activeMountProcess && !isMounted) {
        isMounted = true;
        logToUI(`Drive ${letter}: is active.`, 'success');
        broadcast({ type: 'mount_status', mounted: true, config: activeMountConfig });
      }
    }, 3000);

    child.on('close', (code) => {
      logToUI(`Mount process exited with code ${code}`);
      activeMountProcess = null;
      activeMountConfig = null;
      broadcast({ type: 'mount_status', mounted: false });
      checkAutoShutdown();
    });
  }
}

// Mount Remote API
app.post('/api/mount', (req, res) => {
  const { remote, letter, method, volumeName } = req.body;
  if (activeMountProcess) {
    return res.status(400).json({ error: 'Ya hay un disco montado. Desmóntelo antes de montar otro.' });
  }
  performMount(remote, letter, method, volumeName);
  res.json({ status: 'mounting' });
});

// Unmount remote
app.post('/api/unmount', (req, res) => {
  if (!activeMountProcess) {
    return res.status(400).json({ error: 'No hay ningún disco montado.' });
  }

  const { letter, type } = activeMountConfig;
  logToUI(`Unmounting drive ${letter}:...`);

  // Set autoMount to false in mount_config.json
  try {
    const configPath = path.join(BIN_DIR, 'mount_config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.autoMount = false;
      fs.writeFileSync(configPath, JSON.stringify(config));
    }
  } catch (e) {
    // Ignore
  }

  if (type === 'webdav') {
    // Unmap the Windows network drive first
    exec(`net use ${letter}: /delete /y`, (err) => {
      if (err) {
        logToUI(`Warning during unmapping: ${err.message}`, 'warn');
      }
      
      // Kill server
      if (activeMountProcess) {
        activeMountProcess.kill('SIGTERM');
      }
      res.json({ message: 'Disco desmontado con éxito.' });
    });
  } else {
    // Kill mount process
    if (activeMountProcess) {
      activeMountProcess.kill('SIGTERM');
    }
    // Rclone/WinFsp handles clean unmount when killed
    res.json({ message: 'Disco desmontado con éxito.' });
  }
});

// -------------------------------------------------------------
// Transfer Queue System Engine (Global Scope)
// -------------------------------------------------------------
const transferQueue = [];
let isQueuePaused = false;

function broadcastQueueStatus(extraData = {}) {
  broadcast({
    type: 'transfer_status',
    running: !!activeTransferProcess,
    stats: activeTransferStats,
    queueCount: transferQueue.length,
    queue: transferQueue,
    isQueuePaused: isQueuePaused,
    ...extraData
  });
}

function enqueueOrRunTransferTask(task) {
  task.id = task.id || ('task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
  task.createdAt = task.createdAt || Date.now();

  if (activeTransferProcess || isQueuePaused) {
    transferQueue.push(task);
    logToUI(`Transfer task added to queue (Position #${transferQueue.length}): ${task.action} "${task.sourceArg}" -> "${task.destArg}"`);
    broadcastQueueStatus();
    return { status: 'queued', position: transferQueue.length, id: task.id, message: `Añadido a la cola de espera (Puesto #${transferQueue.length})` };
  } else {
    runTransferTask(task);
    return { status: 'started', id: task.id, message: 'Iniciando transferencia...' };
  }
}

function processNextInQueue() {
  if (activeTransferProcess || isQueuePaused || transferQueue.length === 0) return;
  const nextTask = transferQueue.shift();
  runTransferTask(nextTask);
}

function runTransferTask(task) {
  const { action, sourceArg, destArg } = task;
  logToUI(`Starting ${action} from "${sourceArg}" to "${destArg}"...`);

  const processArgs = [
    '--config', RCLONE_CONF,
    action,
    sourceArg,
    destArg,
    '--stats', '1s',
    '--stats-one-line',
    '--log-level', 'INFO',
    '--onedrive-chunk-size', '20M',
    '--buffer-size', '32M',
    '--exclude', 'node_modules/**',
    '--exclude', '.git/**',
    '--exclude', 'bin/cache/**',
    '--exclude', 'bin/rclone-temp/**',
    '--exclude', 'Thumbs.db',
    '--exclude', 'Desktop.ini',
    '--exclude', 'Almacén personal/**',
    '--exclude', 'Almacen personal/**',
    '--exclude', 'Personal Vault/**'
  ];

  const child = spawn(RCLONE_EXE, processArgs);
  activeTransferProcess = child;
  activeTransferStats = {
    id: task.id,
    mode: action,
    source: sourceArg,
    destination: destArg,
    progress: 0,
    speed: '0 B/s',
    transferred: '0 B',
    total: '0 B',
    eta: 'calculando...',
    lastLog: 'Iniciando...',
    queueLength: transferQueue.length
  };

  broadcastQueueStatus();

  let buffer = '';
  const handleOutput = (data) => {
    buffer += data.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      logToUI(`[TRANSFER] ${trimmed}`);
      const cleanLog = trimmed.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \w+\s*:\s*/, '');
      activeTransferStats.lastLog = cleanLog;

      const match = trimmed.match(/([\d\.]+\s*\w*)\s*\/\s*([\d\.]+\s*\w*),\s*([\d\-]+)%?,\s*([\d\.]+\s*[\w\/]*),\s*ETA\s*([^\s,\(\)]+)/i);
      if (match) {
        activeTransferStats.transferred = match[1];
        activeTransferStats.total = match[2];
        const pct = match[3];
        activeTransferStats.progress = pct === '-' ? 0 : parseInt(pct, 10);
        activeTransferStats.speed = match[4];
        activeTransferStats.eta = match[5];
      }
      activeTransferStats.queueLength = transferQueue.length;
      broadcastQueueStatus();
    }
  };

  child.stdout.on('data', handleOutput);
  child.stderr.on('data', handleOutput);

  child.on('close', (code) => {
    activeTransferProcess = null;
    const finalStats = activeTransferStats;
    activeTransferStats = null;

    if (code === 0) {
      logToUI('Transfer task completed successfully!', 'success');
      broadcastQueueStatus({ success: true, stats: finalStats });
    } else {
      logToUI(`Transfer task failed or cancelled. Code: ${code}`, 'error');
      broadcastQueueStatus({ success: false, error: `Código ${code}` });
    }

    setTimeout(processNextInQueue, 500);
    checkAutoShutdown();
  });
}

// Transfer Start Endpoint
app.post('/api/transfer/start', (req, res) => {
  const { mode, source, destination, subfolder } = req.body;
  if (!source || !destination) {
    return res.status(400).json({ error: 'Falta origen o destino.' });
  }

  let folderName = '';
  try {
    if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
      folderName = path.basename(source);
    }
  } catch (e) {}

  let destRemote = destination;
  if (subfolder) {
    const cleanSub = subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
    if (cleanSub) {
      destRemote = folderName ? `${destination}:${cleanSub}/${folderName}` : `${destination}:${cleanSub}`;
    } else {
      destRemote = folderName ? `${destination}:${folderName}` : `${destination}:`;
    }
  } else {
    destRemote = folderName ? `${destination}:${folderName}` : `${destination}:`;
  }

  const action = mode === 'sync' ? 'sync' : 'copy';
  const result = enqueueOrRunTransferTask({ action, sourceArg: source, destArg: destRemote });
  res.json(result);
});

// Cancel All Transfers & Clear Queue Endpoint
app.post('/api/transfer/cancel', (req, res) => {
  const queueCleared = transferQueue.length;
  transferQueue.length = 0; // Clear pending queue

  if (activeTransferProcess) {
    logToUI('Cancelling active transfer process and clearing queue...');
    activeTransferProcess.kill('SIGTERM');
    activeTransferProcess = null;
    activeTransferStats = null;
    broadcastQueueStatus();
    return res.json({ message: `Transferencia cancelada y ${queueCleared} tareas en cola eliminadas.` });
  }
  broadcastQueueStatus();
  res.json({ message: `Cola de transferencias vaciada (${queueCleared} tareas eliminadas).` });
});

// Queue Management Endpoints (Remove item, Toggle Pause, Clear Pending)
app.post('/api/transfer/queue/remove', (req, res) => {
  const { id } = req.body;
  const idx = transferQueue.findIndex(t => t.id === id);
  if (idx !== -1) {
    const removed = transferQueue.splice(idx, 1)[0];
    logToUI(`Removed task from queue: ${removed.action} "${removed.sourceArg}" -> "${removed.destArg}"`);
    broadcastQueueStatus();
    return res.json({ message: 'Tarea eliminada de la cola.', queueCount: transferQueue.length });
  }
  return res.status(404).json({ error: 'Tarea no encontrada en la cola.' });
});

app.post('/api/transfer/queue/toggle-pause', (req, res) => {
  isQueuePaused = !isQueuePaused;
  logToUI(isQueuePaused ? 'Transfer queue paused.' : 'Transfer queue resumed.');
  if (!isQueuePaused && !activeTransferProcess) {
    processNextInQueue();
  }
  broadcastQueueStatus();
  res.json({ isQueuePaused, message: isQueuePaused ? 'Cola pausada.' : 'Cola reanudada.' });
});

app.post('/api/transfer/queue/clear', (req, res) => {
  const cleared = transferQueue.length;
  transferQueue.length = 0;
  logToUI(`Cleared ${cleared} pending tasks from queue.`);
  broadcastQueueStatus();
  res.json({ message: `${cleared} tareas eliminadas de la cola.` });
});

// -------------------------------------------------------------
// Visual File Explorer APIs (Dual Pane)
// -------------------------------------------------------------

// Local filesystem listing
app.get('/api/fs/local/ls', (req, res) => {
  const reqPath = req.query.path || '';

  // If path is empty or 'drives', list Windows drive letters
  if (!reqPath || reqPath.toLowerCase() === 'drives') {
    exec('powershell -NoProfile -Command "[System.IO.DriveInfo]::GetDrives() | ForEach-Object { @{ Name=$_.Name; Free=$_.TotalFreeSpace; Total=$_.TotalSize; Type=$_.DriveType } | ConvertTo-Json -Compress }"', (err, stdout) => {
      let drives = [];
      try {
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        lines.forEach(l => {
          try {
            const d = JSON.parse(l);
            drives.push({
              name: d.Name.replace('\\', ''),
              path: d.Name,
              isDir: true,
              isDrive: true,
              size: d.Total || 0,
              free: d.Free || 0
            });
          } catch (e) {}
        });
      } catch (e) {}

      if (drives.length === 0) {
        drives = [{ name: 'C:', path: 'C:\\', isDir: true, isDrive: true }];
      }

      res.json({ currentPath: '', isDrivesRoot: true, items: drives });
    });
    return;
  }

  // Normal local folder listing
  const targetPath = path.resolve(reqPath);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'La ruta local especificada no existe.' });
  }

  try {
    const files = fs.readdirSync(targetPath);
    const items = [];

    for (const f of files) {
      try {
        const fullPath = path.join(targetPath, f);
        const stat = fs.statSync(fullPath);
        items.push({
          name: f,
          path: fullPath,
          isDir: stat.isDirectory(),
          size: stat.size,
          modTime: stat.mtime
        });
      } catch (e) {}
    }

    items.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    const parentPath = path.dirname(targetPath) === targetPath ? 'drives' : path.dirname(targetPath);
    res.json({ currentPath: targetPath, parentPath, isDrivesRoot: false, items });
  } catch (error) {
    res.status(500).json({ error: `Error leyendo directorio local: ${error.message}` });
  }
});

// Cloud filesystem listing (Rclone lsjson)
app.get('/api/fs/cloud/ls', (req, res) => {
  const remote = req.query.remote || 'combined';
  const relPath = req.query.path || '';

  const remoteTarget = relPath ? `${remote}:${relPath}` : `${remote}:`;

  exec(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" lsjson "${remoteTarget}"`, (err, stdout, stderr) => {
    if (err) {
      logToUI(`Error listing cloud directory "${remoteTarget}": ${err.message}`, 'error');
      return res.status(500).json({ error: `No se pudo listar la carpeta en la nube: ${stderr || err.message}` });
    }

    try {
      const parsed = JSON.parse(stdout);
      const items = parsed.map(item => ({
        name: item.Name,
        path: relPath ? `${relPath}/${item.Name}` : item.Name,
        isDir: item.IsDir,
        size: item.Size,
        modTime: item.ModTime
      }));

      items.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      const parentPath = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : (relPath ? '' : null);
      res.json({ remote, currentPath: relPath, parentPath, items });
    } catch (e) {
      res.status(500).json({ error: 'Error parseando respuesta de Rclone.' });
    }
  });
});

// File System Batch Operation (Copy, Move, Mkdir, Delete)
app.post('/api/fs/operation', (req, res) => {
  const { action, srcType, srcPath, dstType, dstPath, items, newDirName } = req.body;

  if (action === 'mkdir') {
    if (dstType === 'local') {
      const targetDir = path.join(dstPath, newDirName);
      try {
        fs.mkdirSync(targetDir, { recursive: true });
        logToUI(`Created local directory: ${targetDir}`, 'success');
        return res.json({ message: 'Carpeta creada con éxito.' });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    } else {
      const remoteTarget = dstPath ? `${dstType}:${dstPath}/${newDirName}` : `${dstType}:${newDirName}`;
      exec(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" mkdir "${remoteTarget}"`, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        logToUI(`Created cloud directory: ${remoteTarget}`, 'success');
        res.json({ message: 'Carpeta en la nube creada con éxito.' });
      });
    }
    return;
  }

  if (action === 'delete') {
    if (!items || items.length === 0) return res.status(400).json({ error: 'No hay elementos seleccionados para eliminar.' });

    let deletedCount = 0;
    let errors = [];

    const deleteItem = (idx) => {
      if (idx >= items.length) {
        if (errors.length > 0) return res.status(500).json({ error: errors.join('; ') });
        logToUI(`Deleted ${deletedCount} items successfully!`, 'success');
        return res.json({ message: `${deletedCount} elementos eliminados con éxito.` });
      }

      const item = items[idx];
      if (srcType === 'local') {
        try {
          fs.rmSync(item.path, { recursive: true, force: true });
          deletedCount++;
        } catch (e) {
          errors.push(`Error borrando ${item.name}: ${e.message}`);
        }
        deleteItem(idx + 1);
      } else {
        const cmd = item.isDir ? 'purge' : 'deletefile';
        const remoteTarget = `${srcType}:${item.path}`;
        exec(`"${RCLONE_EXE}" --config "${RCLONE_CONF}" ${cmd} "${remoteTarget}"`, (err) => {
          if (err) errors.push(`Error borrando ${item.name}: ${err.message}`);
          else deletedCount++;
          deleteItem(idx + 1);
        });
      }
    };

    deleteItem(0);
    return;
  }

  if (action === 'copy' || action === 'move' || action === 'sync') {
    if (action === 'sync') {
      let sourceArg = srcType === 'local' ? srcPath : (srcPath ? `${srcType}:${srcPath}` : `${srcType}:`);
      let destArg = dstType === 'local' ? dstPath : (dstPath ? `${dstType}:${dstPath}` : `${dstType}:`);
      const result = enqueueOrRunTransferTask({ action: 'sync', sourceArg, destArg });
      return res.json(result);
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No se seleccionaron elementos.' });
    }

    let lastResult = null;
    items.forEach(item => {
      let sourceArg = srcType === 'local' ? item.path : `${srcType}:${item.path}`;
      let destArg = '';

      if (item.isDir) {
        if (dstType === 'local') {
          destArg = dstPath === 'drives' ? `${item.name}:\\` : path.join(dstPath, item.name);
        } else {
          destArg = dstPath ? `${dstType}:${dstPath}/${item.name}` : `${dstType}:${item.name}`;
        }
      } else {
        if (dstType === 'local') {
          destArg = dstPath;
        } else {
          destArg = dstPath ? `${dstType}:${dstPath}` : `${dstType}:`;
        }
      }

      lastResult = enqueueOrRunTransferTask({ action, sourceArg, destArg });
    });

    return res.json({
      status: transferQueue.length > 0 ? 'queued' : 'started',
      message: items.length > 1 ? `${items.length} tareas agregadas a la cola.` : (lastResult ? lastResult.message : 'Operación iniciada.'),
      position: transferQueue.length
    });
  }

  return res.status(400).json({ error: 'Acción no soportada o datos incompletos.' });
});

// Clean exit process handler
function cleanExit() {
  console.log('Cleaning up subprocesses before exit...');
  
  // Unmount WebDAV drive if active
  if (activeMountConfig && activeMountConfig.type === 'webdav') {
    try {
      execSync(`net use ${activeMountConfig.letter}: /delete /y`, { stdio: 'ignore' });
    } catch (e) {}
  }
  
  // Cleanly terminate active child processes
  if (activeMountProcess) {
    try { activeMountProcess.kill('SIGKILL'); } catch (e) {}
  }
  if (activeConfigProcess) {
    try { activeConfigProcess.kill('SIGKILL'); } catch (e) {}
  }
  if (activeTransferProcess) {
    try { activeTransferProcess.kill('SIGKILL'); } catch (e) {}
  }
}

// Bind process events to clean exit
process.on('exit', cleanExit);
process.on('SIGINT', () => {
  cleanExit();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanExit();
  process.exit(0);
});

// Explicit Shutdown Endpoint
app.post('/api/shutdown', (req, res) => {
  logToUI('Manual shutdown requested. Stopping all services and exiting...', 'warn');
  res.json({ message: 'Apagando el servidor local...' });
  
  // Wait 1 second to let response reach the client, then terminate
  setTimeout(() => {
    cleanExit();
    process.exit(0);
  }, 1000);
});

// Auto-shutdown state
let activeConnections = 0;
let shutdownTimeout = null;

function checkAutoShutdown() {
  if (activeConnections === 0 && !activeMountProcess && !activeTransferProcess) {
    logToUI('No active connections and no active mounts or transfers. Server will exit in 5 seconds...');
    if (shutdownTimeout) clearTimeout(shutdownTimeout);
    shutdownTimeout = setTimeout(() => {
      logToUI('Auto-shutdown: No clients, mounts, or transfers remaining. Closing server.', 'system');
      process.exit(0);
    }, 5000);
  }
}

// WebSocket Connection
wss.on('connection', (ws) => {
  activeConnections++;
  logToUI(`Web Client dashboard connected to logger. Active connections: ${activeConnections}`);
  
  if (shutdownTimeout) {
    clearTimeout(shutdownTimeout);
    shutdownTimeout = null;
    logToUI('Auto-shutdown cancelled (client connected).');
  }

  // Send current status immediately
  ws.send(JSON.stringify({
    type: 'status',
    data: {
      rcloneStatus,
      winfspInstalled: checkWinFsp(),
      mounted: activeMountProcess !== null,
      mountConfig: activeMountConfig,
      cacheSize: getCacheSize(),
      transferRunning: activeTransferProcess !== null,
      transferStats: activeTransferStats
    }
  }));

  ws.on('close', () => {
    activeConnections--;
    logToUI(`Web Client disconnected. Active connections: ${activeConnections}`);
    checkAutoShutdown();
  });
});

function openInDesktopMode(url) {
  // Try launching Edge in App Mode (which works on all Windows 10/11 machines)
  const edgeCmd = `start msedge --app=${url} --window-size=1200,800`;
  exec(edgeCmd, (err) => {
    if (err) {
      logToUI('Could not open in Edge App Mode, falling back to default browser.', 'warn');
      open(url);
    }
  });
}

// Check and restore mount on startup
function checkAutoMount() {
  const configPath = path.join(BIN_DIR, 'mount_config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.autoMount && config.remote && config.letter && config.method) {
        logToUI(`Auto-mount: Restoring drive mount for "${config.remote}" on "${config.letter}:" using ${config.method}...`);
        performMount(config.remote, config.letter, config.method, config.volumeName);
      }
    } catch (e) {
      logToUI(`Error loading auto-mount configuration: ${e.message}`, 'error');
    }
  }
}

// Start Server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  checkRclone();
  
  // Restore mount if active previously
  setTimeout(checkAutoMount, 2000);
  
  // Auto open in Edge App Mode (or default browser)
  setTimeout(() => {
    openInDesktopMode(`http://localhost:${PORT}`);
  }, 1000);
});
