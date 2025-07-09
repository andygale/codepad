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
      }
    };
    this.workspaceDir = path.join(__dirname, 'workspace');
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
      const platform = process.platform === 'darwin' ? 'config_mac' : 
                     process.platform === 'win32' ? 'config_win' : 'config_linux';
      
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
        path.join(__dirname, 'jdt-language-server', platform),
        '-data',
        path.join(__dirname, 'workspace')
      ];
    }
    
    return [];
  }

  async startLanguageServer(language) {
    console.log(`[LS Manager] Starting language server for ${language}`);
    
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
      const workspaceDir = path.join(__dirname, 'workspace');
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

      // Add a small delay to ensure the server is ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
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
          const workspaceDir = path.join(__dirname, 'workspace');
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