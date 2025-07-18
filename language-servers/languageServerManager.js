const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class LanguageServerManager {
  constructor() {
    this.servers = new Map();
    this.serverConfigs = {
      kotlin: {
        name: 'Kotlin Language Server',
        command: path.join(__dirname, 'kotlin-language-server', 'server', 'bin', 'kotlin-language-server'),
        args: [],
        downloadUrl: 'https://github.com/fwcd/kotlin-language-server/releases/latest/download/server.zip',
        executable: path.join(__dirname, 'kotlin-language-server', 'server', 'bin', 'kotlin-language-server'),
        serverDir: path.join(__dirname, 'kotlin-language-server'),
        extension: 'kt'
      },
      java: {
        name: 'Eclipse JDT Language Server',
        command: process.env.NODE_ENV === 'production' ? 'java' : '/opt/homebrew/opt/openjdk@21/bin/java',
        args: [], // Will be populated dynamically
        downloadUrl: 'https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz',
        executable: process.env.NODE_ENV === 'production' ? 'java' : '/opt/homebrew/opt/openjdk@21/bin/java',
        serverDir: path.join(__dirname, 'jdt-language-server'),
        extension: 'java'
      },
      python: {
        name: 'Pyright Language Server',
        command: process.platform === 'win32'
          ? path.join(__dirname, '..', 'server', 'node_modules', '.bin', 'pyright-langserver.cmd')
          : path.join(__dirname, '..', 'server', 'node_modules', '.bin', 'pyright-langserver'),
        args: ['--stdio'],
        executable: process.platform === 'win32'
          ? path.join(__dirname, '..', 'server', 'node_modules', '.bin', 'pyright-langserver.cmd')
          : path.join(__dirname, '..', 'server', 'node_modules', '.bin', 'pyright-langserver'),
        serverDir: path.join(__dirname, '..', 'server'),
        extension: 'py'
      }
    };
    this.workspaceDir = '/tmp/lsp-workspace';

    // Ensure workspace directory exists and set up periodic cleanup of stale session dirs
    if (!fs.existsSync(this.workspaceDir)) {
      fs.mkdirSync(this.workspaceDir, { recursive: true });
    }

    // Clean up once on startup and then every 6 hours
    this.cleanupOldSessionDirs();
    const interval = setInterval(() => this.cleanupOldSessionDirs(), 6 * 60 * 60 * 1000);
    // Allow Node process to exit naturally when this is the only active timer (e.g., during install.js)
    interval.unref();
  }

  /**
   * Removes session workspace sub-directories older than MAX_AGE_MS (default 24 h)
   */
  cleanupOldSessionDirs(maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
      const now = Date.now();
      const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
      entries.forEach(entry => {
        if (!entry.isDirectory()) return;
        const fullPath = path.join(this.workspaceDir, entry.name);
        // Skip dot folders or metadata directories that are part of LS itself
        if (entry.name.startsWith('.')) return;

        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`[LS Manager] Removed stale workspace directory: ${fullPath}`);
          }
        } catch (err) {
          console.error('[LS Manager] Error checking/removing workspace dir', fullPath, err);
        }
      });
    } catch (err) {
      console.error('[LS Manager] Failed to clean old session workspaces', err);
    }
  }

  getWorkspaceDir() {
    return this.workspaceDir;
  }

  getLanguageExtension(language) {
    return this.serverConfigs[language]?.extension || 'txt';
  }

  getLanguageServerArgs(language) {
    const config = this.serverConfigs[language];
    
    if (language === 'kotlin') {
      return config.args;
    } else if (language === 'java') {
      // Use the Eclipse Equinox launcher
      const pluginsDir = path.join(__dirname, 'jdt-language-server', 'plugins');
      const launcherFiles = fs.readdirSync(pluginsDir).filter(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
      
      if (launcherFiles.length === 0) {
        throw new Error('Eclipse Equinox launcher JAR not found');
      }
      
      const launcherPath = path.join(pluginsDir, launcherFiles[0]);
      // Choose correct SWT configuration dir.
      let platform;
      if (process.platform === 'darwin') {
        platform = 'config_mac';
      } else if (process.platform === 'win32') {
        platform = 'config_win';
      } else {
        // Linux – distinguish architecture
        platform = process.arch === 'arm64' ? 'config_linux_arm' : 'config_linux';
      }
      
      // Use writable configuration directory
      let configPath = path.join(__dirname, 'jdt-language-server', platform);
      
      // Check if configuration directory is writable, if not use /tmp
      try {
        fs.accessSync(configPath, fs.constants.W_OK);
      } catch (error) {
        // Config directory is not writable, use /tmp copy
        const writableConfigPath = path.join('/tmp', platform);
        if (!fs.existsSync(writableConfigPath)) {
          // Copy config to writable location
          const { execSync } = require('child_process');
          execSync(`cp -r "${configPath}" "${writableConfigPath}"`);
        }
        configPath = writableConfigPath;
      }
      
      // Use writable workspace directory
      const workspacePath = '/tmp/jdt-workspace';
      
      return [
        '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-Dlog.level=ALL',
        '-noverify',
        '-Xmx1G',
        '-jar',
        launcherPath,
        '-configuration',
        configPath,
        '-data',
        workspacePath
      ];
    }
    
    return config?.args || [];
  }

  async startLanguageServer(language) {
    console.log(`[LS Manager] Starting language server for ${language} (host arch=${process.arch}, platform=${process.platform})`);
    
    if (this.servers.has(language)) {
      console.log(`[LS Manager] Language server for ${language} already running`);
      return this.servers.get(language);
    }

    const config = this.serverConfigs[language];
    if (!config) {
      throw new Error(`Language server not configured for: ${language}`);
    }

    // Check if language server is installed
    const isInstalled = await this.isLanguageServerInstalled(language);
    if (!isInstalled) {
      console.log(`[LS Manager] Installing ${config.name}...`);
      await this.installLanguageServer(language);
    }

    console.log(`[LS Manager] Starting ${config.name}...`);
    
    // Ensure workspace directory exists for Java
    if (language === 'java') {
      const workspaceDir = '/tmp/jdt-workspace';
      if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
        console.log(`[LS Manager] Created workspace directory: ${workspaceDir}`);
      }
    }
    
    // Get the correct args for the language server
    const args = this.getLanguageServerArgs(language);
    const cwd = language === 'kotlin' ? path.join(config.serverDir, 'server') : config.serverDir;
    
    console.log(`[LS Manager] Command: ${config.command}`);
    console.log(`[LS Manager] Args: ${JSON.stringify(args)}`);
    console.log(`[LS Manager] CWD: ${cwd}`);
    
    try {
      const server = spawn(config.command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: cwd
      });

      server.stdout.on('data', (data) => {
        console.log(`[${language.toUpperCase()} LS][stdout] ${data.toString().trim()}`);
      });
      server.stderr.on('data', (data) => {
        console.error(`[${language.toUpperCase()} LS][stderr] ${data.toString().trim()}`);
      });

      const serverInfo = {
        process: server,
        language,
        config,
        stdin: server.stdin,
        stdout: server.stdout,
        stderr: server.stderr
      };

      this.servers.set(language, serverInfo);

      server.on('exit', (code, signal) => {
        console.log(`[LS Manager] ${config.name} exited with code ${code}, signal ${signal}`);
        this.servers.delete(language);
      });

      server.on('error', (error) => {
        console.error(`[LS Manager] ${config.name} error:`, error);
        this.servers.delete(language);
      });

      // Wait briefly; if the process has already exited, treat as failure.
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (server.exitCode !== null) {
        throw new Error(`${config.name} exited immediately with code ${server.exitCode}`);
      }

      console.log(`[LS Manager] ${config.name} started successfully with PID: ${server.pid}`);
      return serverInfo;
    } catch (error) {
      console.error(`[LS Manager] Failed to start ${config.name}:`, error);
      throw error;
    }
  }

  async stopLanguageServer(language) {
    const server = this.servers.get(language);
    if (server) {
      server.process.kill();
      this.servers.delete(language);
      console.log(`Stopped ${server.config.name}`);
    }
  }

  async stopAllLanguageServers() {
    for (const [language] of this.servers) {
      await this.stopLanguageServer(language);
    }
  }

  getLanguageServer(language) {
    return this.servers.get(language);
  }

  async isLanguageServerInstalled(language) {
    const config = this.serverConfigs[language];
    if (language === 'java') {
      return fs.existsSync(config.serverDir);
    } else if (language === 'kotlin') {
      return fs.existsSync(config.executable);
    } else if (language === 'python') {
      return fs.existsSync(config.command);
    }
    return false;
  }

  async installLanguageServer(language) {
    const config = this.serverConfigs[language];
    
    if (language === 'kotlin') {
      return this.installKotlinLanguageServer(config);
    } else if (language === 'java') {
      return this.installJavaLanguageServer(config);
    }
  }

  async installKotlinLanguageServer(config) {
    const axios = (await import('../server/node_modules/axios/index.js')).default;
    const AdmZip = require('../server/node_modules/adm-zip');
    
    console.log('Downloading Kotlin Language Server...');
    
    // Create server directory
    if (!fs.existsSync(config.serverDir)) {
      fs.mkdirSync(config.serverDir, { recursive: true });
    }

    // Download and extract
    const response = await axios({
      method: 'get',
      url: config.downloadUrl,
      responseType: 'stream'
    });

    const zipPath = path.join(config.serverDir, 'server.zip');
    const writer = fs.createWriteStream(zipPath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(config.serverDir, true);
        fs.unlinkSync(zipPath);

        // Find the server jar file in the extracted directory
        const findServerJar = (dir) => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              const found = findServerJar(fullPath);
              if (found) return found;
            } else if (file.startsWith('server-') && file.endsWith('.jar')) {
              return fullPath;
            }
          }
          return null;
        };

        // Make the kotlin-language-server executable
        const executablePath = path.join(config.serverDir, 'server', 'bin', 'kotlin-language-server');
        if (fs.existsSync(executablePath)) {
          fs.chmodSync(executablePath, '755');

          // Ensure an up-to-date kotlinx-coroutines jar is present for IntelliSense support
          await (async () => {
            try {
              const desiredVersion = '1.10.2';
              const jarName = `kotlinx-coroutines-core-jvm-${desiredVersion}.jar`;
              const libDir = path.join(config.serverDir, 'server', 'lib');

              // Remove any old coroutines jars to avoid duplicate classes
              const existing = fs.readdirSync(libDir).filter(f => f.startsWith('kotlinx-coroutines-core-jvm-') && f.endsWith('.jar'));
              existing.forEach(f => {
                if (f !== jarName) {
                  fs.rmSync(path.join(libDir, f));
                  console.log(`[LS Manager] Removed outdated ${f}`);
                }
              });

              const targetPath = path.join(libDir, jarName);
              if (!fs.existsSync(targetPath)) {
                console.log(`[LS Manager] Downloading ${jarName} for coroutine support...`);
                const axios = (await import('../server/node_modules/axios/index.js')).default;
                const url = `https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/${desiredVersion}/${jarName}`;
                const resp = await axios({ method: 'get', url, responseType: 'stream' });
                const writer = fs.createWriteStream(targetPath);
                await new Promise((res, rej) => {
                  resp.data.pipe(writer);
                  writer.on('finish', res);
                  writer.on('error', rej);
                });
                console.log(`[LS Manager] Added ${jarName}`);
              }
            } catch (err) {
              console.error('[LS Manager] Failed to set up kotlinx-coroutines jar', err);
            }
          })();

          console.log('Kotlin Language Server installed successfully');
          resolve();
        } else {
          reject(new Error('kotlin-language-server executable not found in extracted files'));
        }
      });
      writer.on('error', reject);
    });
  }

  async installJavaLanguageServer(config) {
    const axios = (await import('../server/node_modules/axios/index.js')).default;
    const tar = require('../server/node_modules/tar');
    
    console.log('Downloading Eclipse JDT Language Server...');
    
    // Create server directory
    if (!fs.existsSync(config.serverDir)) {
      fs.mkdirSync(config.serverDir, { recursive: true });
    }

    // Download and extract
    const response = await axios({
      method: 'get',
      url: config.downloadUrl,
      responseType: 'stream'
    });

    const tarPath = path.join(config.serverDir, 'jdt-language-server.tar.gz');
    const writer = fs.createWriteStream(tarPath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        tar.extract({
          file: tarPath,
          cwd: config.serverDir
        }).then(() => {
          fs.unlinkSync(tarPath);
          
          // Create workspace directory
          const workspaceDir = '/tmp/jdt-workspace';
          if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
          }
          
          console.log('Eclipse JDT Language Server installed successfully');
          resolve();
        }).catch(reject);
      });
      writer.on('error', reject);
    });
  }
}

module.exports = LanguageServerManager;