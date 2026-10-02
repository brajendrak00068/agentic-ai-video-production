const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(msg) {
  console.log(`\x1b[36m[Sync & Publish]\x1b[0m ${msg}`);
}

function runCmd(cmd, dir = __dirname) {
  log(`Running: "${cmd}"...`);
  try {
    const out = execSync(cmd, { cwd: dir, encoding: 'utf-8', stdio: 'inherit' });
    return { success: true, out };
  } catch (err) {
    console.error(`\x1b[31m❌ Command failed:\x1b[0m ${cmd}\nError: ${err.message}`);
    return { success: false, error: err };
  }
}

async function main() {
  log('Starting unified update and publication cycle...');

  // 1. Recompile the TypeScript source files
  const buildResult = runCmd('npm run build');
  if (!buildResult.success) {
    process.exit(1);
  }

  // 2. Programmatically load compiled tools & extract metadata
  log('Extracting compiled tool schemas from dist/index.js...');
  const manifestPath = path.join(__dirname, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ manifest.json not found!');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  try {
    const { TOOLS } = require('./dist/index.js');
    if (!TOOLS || !Array.isArray(TOOLS)) {
      throw new Error('TOOLS array is missing or invalid in compiled dist/index.js');
    }

    log(`Found ${TOOLS.length} tools. Syncing schemas into manifest.tools and manifest._meta...`);

    // 1. Sync array of tools for MCPB / Smithery capability inspection
    manifest.tools = TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));

    // 2. Format tools to fit the object dictionary schema expected by MCPB spec
    const toolsObj = {};
    for (const tool of TOOLS) {
      toolsObj[tool.name] = {
        description: tool.description,
        inputSchema: tool.inputSchema
      };
    }

    manifest._meta = {
      tools: toolsObj
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    log('Successfully updated manifest.json statically with all tool capabilities!');
  } catch (err) {
    console.error(`❌ Failed to sync tool schemas: ${err.message}`);
    process.exit(1);
  }

  // 3. Compile the local folder into a portable .mcpb bundle
  log('Packaging bundle into server.mcpb...');
  const packResult = runCmd('npx -y @anthropic-ai/mcpb pack . server.mcpb');
  if (!packResult.success) {
    process.exit(1);
  }

  // 3b. Inject full inputSchema into manifest.json inside server.mcpb for Smithery capability indexing
  // Note: @anthropic-ai/mcpb validate rejects inputSchema in manifest.tools, but Smithery API requires it.
  log('Injecting full inputSchema into server.mcpb for Smithery capability introspection...');
  const pyInjectCmd = `python3 -c "
import zipfile, json, os
mcpb_path = os.path.join(os.getcwd(), 'server.mcpb')
with zipfile.ZipFile(mcpb_path, 'r') as zin:
    manifest = json.loads(zin.read('manifest.json').decode('utf-8'))
with open('manifest.json') as f:
    local_manifest = json.load(f)
manifest['tools'] = [
    {
        'name': name,
        'description': info.get('description', ''),
        'inputSchema': info.get('inputSchema', {'type': 'object', 'properties': {}})
    }
    for name, info in local_manifest.get('_meta', {}).get('tools', {}).items()
]
tmp_path = mcpb_path + '.tmp'
with zipfile.ZipFile(mcpb_path, 'r') as zin:
    with zipfile.ZipFile(tmp_path, 'w') as zout:
        for item in zin.infolist():
            if item.filename == 'manifest.json':
                zout.writestr(item, json.dumps(manifest, indent=2))
            else:
                zout.writestr(item, zin.read(item.filename))
os.replace(tmp_path, mcpb_path)
"`;
  const injectResult = runCmd(pyInjectCmd);
  if (!injectResult.success) {
    process.exit(1);
  }

  // 4. Automatically publish to Smithery
  log('Publishing latest release bundle to Smithery Registry...');
  // We automatically echo "y" to bypass interactive creation prompts if the server is updated or re-released
  const publishResult = runCmd('echo "y" | smithery mcp publish ./server.mcpb -n brajendrak00068/levea-ai-video-editor');
  if (!publishResult.success) {
    process.exit(1);
  }

  log('✨ Unified update, sync, and publish cycle completed successfully! Your Smithery page is now fully updated.');
}

main().catch(err => {
  console.error(`Fatal sync error: ${err.stack || err}`);
  process.exit(1);
});
