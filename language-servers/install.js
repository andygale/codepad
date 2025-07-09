#!/usr/bin/env node

const LanguageServerManager = require('./languageServerManager');

async function installLanguageServers() {
  console.log('🔧 Installing Language Servers...');
  
  const manager = new LanguageServerManager();
  
  try {
    // Install Kotlin Language Server
    console.log('📦 Installing Kotlin Language Server...');
    const kotlinInstalled = await manager.isLanguageServerInstalled('kotlin');
    if (!kotlinInstalled) {
      await manager.installLanguageServer('kotlin');
      console.log('✅ Kotlin Language Server installed successfully');
    } else {
      console.log('✅ Kotlin Language Server already installed');
    }
    
    // Install Java Language Server  
    console.log('📦 Installing Java Language Server...');
    const javaInstalled = await manager.isLanguageServerInstalled('java');
    if (!javaInstalled) {
      await manager.installLanguageServer('java');
      console.log('✅ Java Language Server installed successfully');
    } else {
      console.log('✅ Java Language Server already installed');
    }
    
    console.log('🎉 All language servers installed successfully!');
    console.log('');
    console.log('Available IntelliSense features:');
    console.log('  • Auto-completion');
    console.log('  • Error detection');
    console.log('  • Hover information');
    console.log('  • Real-time diagnostics');
    console.log('');
    console.log('Supported languages: Kotlin, Java');
    
  } catch (error) {
    console.error('❌ Error installing language servers:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  installLanguageServers();
}

module.exports = installLanguageServers;