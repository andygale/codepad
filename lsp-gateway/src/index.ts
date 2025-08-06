import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

async function spawnLanguageServer(language: string, sessionId?: string) {
  let cmd: string;
  let args: string[] = [];
  let cwd = '/tmp';
  let workspaceDir: string | undefined;
  let projectDir: string | undefined;

  if (language === 'kotlin') {
    cmd = '/opt/kotlin-ls/server/bin/kotlin-language-server';
  } else if (language === 'python') {
    cmd = 'python3';
    args = ['-m', 'pylsp'];
    
    // Create unique workspace for Python session
    workspaceDir = `/tmp/python-workspace-${sessionId || 'default'}`;
    projectDir = path.join(workspaceDir, 'project');
    
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    
    // Create basic Python project structure
    const pythonSrcDir = path.join(projectDir, 'src');
    fs.mkdirSync(pythonSrcDir, { recursive: true });
    
    // Create a basic requirements.txt for potential dependencies
    const requirementsFile = path.join(projectDir, 'requirements.txt');
    const requirementsContent = `# Python project dependencies\n# Add your dependencies here\n`;
    fs.writeFileSync(requirementsFile, requirementsContent, 'utf8');
    
    // Create pyproject.toml for modern Python project configuration
    const pyprojectFile = path.join(projectDir, 'pyproject.toml');
    const pyprojectContent = `[build-system]
requires = ["setuptools>=45", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "codecrush-session"
version = "0.1.0"
description = "CodeCrush collaborative coding session"
requires-python = ">=3.8"

[tool.mypy]
python_version = "3.11"
warn_return_any = false
warn_unused_configs = false
ignore_missing_imports = true
show_error_codes = false
disallow_untyped_defs = false
check_untyped_defs = false
no_implicit_optional = false
strict_optional = false

[tool.pylsp-mypy]
enabled = false
live_mode = false
strict = false

[tool.black]
line-length = 88
target-version = ['py311']

[tool.pycodestyle]
max-line-length = 88
ignore = "E203,E301,E302,E305,W503"

[tool.pyflakes]
# Disable pyflakes for scratch coding environment
`;
    fs.writeFileSync(pyprojectFile, pyprojectContent, 'utf8');
    
    // Create improved setup.cfg for Python tools
    const setupCfgFile = path.join(projectDir, 'setup.cfg');
    const setupCfgContent = `[metadata]
name = codecrush-session
version = 0.1.0

[options]
packages = find:
python_requires = >=3.8

[tool:pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*

[mypy]
python_version = 3.11
warn_return_any = False
warn_unused_configs = False
ignore_missing_imports = True
show_error_codes = False
disallow_untyped_defs = False
check_untyped_defs = False
no_implicit_optional = False
strict_optional = False

[flake8]
max-line-length = 88
extend-ignore = E203,E301,E302,E305,W503

[pycodestyle]
max-line-length = 88
ignore = E203,E301,E302,E305,W503
`;
    fs.writeFileSync(setupCfgFile, setupCfgContent, 'utf8');
    
    // Create .python-version file for Python version management
    const pythonVersionFile = path.join(projectDir, '.python-version');
    fs.writeFileSync(pythonVersionFile, '3.11.2\n', 'utf8');
    
    // Create __init__.py files to make directories proper Python packages
    const srcInitFile = path.join(pythonSrcDir, '__init__.py');
    fs.writeFileSync(srcInitFile, '# CodeCrush Python session\n', 'utf8');
    
    // Create a .pylintrc file to configure pylint (if used)
    const pylintrcFile = path.join(projectDir, '.pylintrc');
    const pylintrcContent = `[MASTER]
load-plugins=

[MESSAGES CONTROL]
disable=missing-module-docstring,missing-class-docstring,missing-function-docstring,invalid-name,too-few-public-methods

[FORMAT]
max-line-length=88
`;
    fs.writeFileSync(pylintrcFile, pylintrcContent, 'utf8');
  } else if (language === 'java') {
    // Search recursively for the Equinox launcher jar
    const root = '/opt/jdt-language-server';
    const pluginsDir = path.join(root, 'plugins');

    let launcherPath: string | undefined;
    if (fs.existsSync(pluginsDir)) {
      const launchers = fs.readdirSync(pluginsDir).filter(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
      if (launchers.length) launcherPath = path.join(pluginsDir, launchers[0]);
    }
    if (!launcherPath) {
      // fallback: recursive search
      function findLauncher(dir: string): string | undefined {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            const nested = findLauncher(full);
            if (nested) return nested;
          } else if (e.name.startsWith('org.eclipse.equinox.launcher_') && e.name.endsWith('.jar') && !e.name.includes('macosx')) {
            return full;
          }
        }
        return undefined;
      }
      launcherPath = findLauncher(root);
    }
    if (!launcherPath) throw new Error('JDT LS launcher JAR not found');
    // Discover configuration directory (config_*). Many snapshots include architecture suffixes.
    // Prefer root-level config.ini if present (newer snapshots)
    let configDir: string | undefined = fs.existsSync(path.join(root, 'config.ini')) ? root : undefined;
    // Otherwise search for config_* folders that contain config.ini
    if (!configDir) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('config_')) {
          const candidate = path.join(root, entry.name);
          if (fs.existsSync(path.join(candidate, 'config.ini'))) {
            configDir = candidate;
            break;
          }
        }
      }
    }
    if (!configDir) {
      throw new Error('JDT LS configuration directory not found');
    }

    // ---- Patch any config.ini that references the missing compatibility.state bundle ----
    try {
      // find all config.ini files under configDir (some distros nest it differently)
      const findConfigIni = (dir: string): string[] => {
        const result: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            result.push(...findConfigIni(full));
          } else if (entry.isFile() && entry.name === 'config.ini') {
            result.push(full);
          }
        }
        return result;
      };
      const configFiles = findConfigIni(configDir);
      let compatJarExists = false;
      try {
        const jarList = fs.existsSync(path.join(root, 'plugins'))
          ? fs.readdirSync(path.join(root, 'plugins'))
          : fs.readdirSync(root);
        compatJarExists = jarList.some(f => f.startsWith('org.eclipse.osgi.compatibility.state_'));
      } catch {
        compatJarExists = false;
      }
      for (const cfg of configFiles) {
        let ini = fs.readFileSync(cfg, 'utf8');
        if (ini.includes('org.eclipse.osgi.compatibility.state')) {
          let modified = ini;
          // Remove compatibility.state bundle line(s)
          modified = modified.split(/\r?\n/).filter(l => !l.includes('org.eclipse.osgi.compatibility.state')).join('\n');
          // Fix paths that still reference plugins/ when jars are at root
          modified = modified.replace(/reference:file:plugins\//g, 'reference:file:');
          modified = modified.replace(/file:plugins\//g, 'file:');
          const patched = modified;
          if (patched !== ini) {
            fs.writeFileSync(cfg, patched, 'utf8');
            console.log(`[java LS] Patched ${path.relative(root, cfg)} to remove missing compatibility.state bundle`);
          }
        }
      }
    } catch (err) {
      console.error('[java LS] Failed to patch config.ini files', err);
    }

    cmd = 'java';
    cwd = root;

    // Create unique workspace for each session to avoid conflicts
         // Create a unique workspace for this session
     workspaceDir = `/tmp/jdt-workspace-${sessionId || 'default'}`;
     // A project directory will live inside the workspace
     projectDir = path.join(workspaceDir, 'project');
    
    fs.mkdirSync(workspaceDir, { recursive: true });
    
    // Create a basic src directory for Java files
    const srcDir = path.join(projectDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    
    // Create a basic Java project structure with .project file
    const projectFile = path.join(projectDir, '.project');
    const projectContent = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
	<name>project</name>
	<comment></comment>
	<projects>
	</projects>
	<buildSpec>
		<buildCommand>
			<name>org.eclipse.jdt.core.javabuilder</name>
			<arguments>
			</arguments>
		</buildCommand>
	</buildSpec>
	<natures>
		<nature>org.eclipse.jdt.core.javanature</nature>
	</natures>
</projectDescription>`;
    fs.writeFileSync(projectFile, projectContent, 'utf8');
    
    // Create .classpath file
    const classpathFile = path.join(projectDir, '.classpath');
    const classpathContent = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
	<classpathentry kind="src" path="src"/>
	<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-17"/>
	<classpathentry kind="output" path="bin"/>
</classpath>`;
    fs.writeFileSync(classpathFile, classpathContent, 'utf8');

    args = [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.protocol=true',
      '-Dlog.level=ALL',
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-Xms1g', '-Xmx2g',
      '-jar', launcherPath,
      '-configuration', configDir,
      '-data', workspaceDir
    ];
  } else {
    throw new Error(`Unsupported language ${language}`);
  }

  const proc = spawn(cmd, args, { stdio: 'pipe', cwd });
  proc.stderr.on('data', (d) => console.error(`[${language} LS][stderr]`, d.toString().trim()));
  proc.on('exit', (code, sig) => console.log(`[${language} LS] exited code=${code} sig=${sig}`));
  console.log(`Spawned ${language} LS pid=${proc.pid} for session ${sessionId || 'default'}`);
  
  // Store workspace info for this session
  (proc as any).workspaceDir = (language === 'java' || language === 'kotlin' || language === 'python') ? workspaceDir : undefined;
  (proc as any).projectDir = (language === 'java' || language === 'kotlin' || language === 'python') ? projectDir : undefined;
  return proc;
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = req.url || '';
    const langMatch = url.match(/^\/(kotlin|java|python)$/);
    if (!langMatch) {
      socket.destroy();
      return;
    }
    const language = langMatch[1];

    // Create unique session ID for this connection
    const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    
    let lsProc;
    try {
      lsProc = await spawnLanguageServer(language, sessionId);
    } catch (err) {
      console.error(err);
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        // Expect incoming data to be a JSON string. Wrap in Content-Length framing.
                const json = typeof data === 'string' ? data : data.toString();
        console.log(`[CLIENT -> LS] ${json}`);
         
         // For Java, Kotlin, and Python sessions, intercept initialize request to fix workspace paths
         if ((language === 'java' || language === 'kotlin' || language === 'python') && (lsProc as any).workspaceDir && (lsProc as any).projectDir) {
          try {
            const message = JSON.parse(json);
            if (message.method === 'initialize') {
              console.log(`[${language} LS] Original initialize request:`, JSON.stringify(message.params, null, 2));
              // Update initialize request with correct workspace
                             // Both rootUri and workspaceFolders point to the same directory (workspace = project)
               message.params.rootUri = `file://${(lsProc as any).projectDir}`;
               message.params.workspaceFolders = [
                 {
                   uri: `file://${(lsProc as any).projectDir}`,
                   name: 'project'
                 }
               ];
              console.log(`[${language} LS] Updated initialize request - rootUri: ${message.params.rootUri}, workspaceDir: ${(lsProc as any).workspaceDir}, projectDir: ${(lsProc as any).projectDir}`);
              console.log(`[${language} LS] Updated initialize request params:`, JSON.stringify(message.params, null, 2));
              
              // Send corrected message to LSP server
              const correctedJson = JSON.stringify(message);
              const payload = Buffer.from(correctedJson, 'utf8');
              const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
              lsProc.stdin.write(Buffer.concat([header, payload]));
              
              // Also send workspace configuration to client immediately
              console.log(`[${language} LS] Sending workspace config to client: ${(lsProc as any).projectDir}`);
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'workspace/didChangeConfiguration',
                params: {
                  settings: {
                    workspaceDir: (lsProc as any).workspaceDir,
                    projectDir: (lsProc as any).projectDir
                  }
                }
              }));
              
              // For Kotlin, also send a didChangeWatchedFiles to trigger project analysis
              if (language === 'kotlin') {
                setTimeout(() => {
                  console.log(`[${language} LS] Triggering Kotlin project analysis`);
                  // Notify about gradle files to trigger dependency resolution
                  const buildGradleUri = `file://${(lsProc as any).projectDir}/build.gradle.kts`;
                  lsProc.stdin.write(Buffer.concat([
                    Buffer.from(`Content-Length: ${JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'workspace/didChangeWatchedFiles',
                      params: {
                        changes: [
                          { uri: buildGradleUri, type: 1 } // Created
                        ]
                      }
                    }).length}\r\n\r\n`, 'utf8'),
                    Buffer.from(JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'workspace/didChangeWatchedFiles',
                      params: {
                        changes: [
                          { uri: buildGradleUri, type: 1 } // Created
                        ]
                      }
                    }), 'utf8')
                  ]));
                }, 1000);
              }
              
              return; // Don't process the original message
            }
          } catch (e) {
            // If JSON parsing fails, fall through to normal processing
          }
        }
        
        const payload = Buffer.from(json, 'utf8');
        const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
        lsProc.stdin.write(Buffer.concat([header, payload]));
      });

      // Buffer and parse LS stdout into individual JSON messages using Content-Length framing
      let buffer = Buffer.alloc(0);
      lsProc.stdout.on('data', (chunk) => {
        console.log(`[${language} LS]`, chunk.toString().trim());
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) break;
          const header = buffer.slice(0, headerEnd).toString('utf8');
          const match = header.match(/Content-Length: (\d+)/i);
          if (!match) {
            // Malformed header – discard
            buffer = buffer.slice(headerEnd + 4);
            continue;
          }
          const length = parseInt(match[1], 10);
          const totalLen = headerEnd + 4 + length;
          if (buffer.length < totalLen) break; // Wait for more data
          const jsonPayload = buffer.slice(headerEnd + 4, totalLen).toString('utf8');
          console.log(`[LS -> CLIENT] ${jsonPayload}`);
          ws.send(jsonPayload); // send as text frame
          buffer = buffer.slice(totalLen);
        }
      });

      const cleanup = () => {
        console.log(`[${language} LS] client disconnected, killing process for session ${sessionId}`);
        lsProc.kill();
        
        // Clean up workspace directory for Java, Kotlin, and Python sessions
        if ((language === 'java' || language === 'kotlin' || language === 'python') && (lsProc as any).workspaceDir) {
          try {
            fs.rmSync((lsProc as any).workspaceDir, { recursive: true, force: true });
            console.log(`[${language} LS] cleaned up workspace ${(lsProc as any).workspaceDir}`);
          } catch (err) {
            console.error(`[${language} LS] failed to cleanup workspace:`, err);
          }
        }
      };
      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  server.listen(port, () => console.log(`LSP gateway listening on ${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
