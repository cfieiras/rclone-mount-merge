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
    cacheSize: getCacheSize()
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
      '--onedrive-chunk-size', '100M',
      '--buffer-size', '32M',
      '--cache-dir', path.join(BIN_DIR, 'cache')
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
      '--onedrive-chunk-size', '100M',
      '--buffer-size', '32M',
      '--cache-dir', path.join(BIN_DIR, 'cache')
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

// Auto-shutdown state
let activeConnections = 0;
let shutdownTimeout = null;

function checkAutoShutdown() {
  if (activeConnections === 0 && !activeMountProcess) {
    logToUI('No active connections and no active mounts. Server will exit in 5 seconds...');
    if (shutdownTimeout) clearTimeout(shutdownTimeout);
    shutdownTimeout = setTimeout(() => {
      logToUI('Auto-shutdown: No clients or mounts remaining. Closing server.', 'system');
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
      mountConfig: activeMountConfig
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
