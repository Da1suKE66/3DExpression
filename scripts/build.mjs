import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { APP_VERSION, SCHEMA_VERSION, PROTOCOL_VERSION, PROJECT_ID, OFFICIAL_TITLE, PARAMS, TASKS, COEFFICIENTS, QUESTIONS } from '../app/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const assert = (name, result, detail = null) => { checks.push({ name, passed: Boolean(result), detail }); if (!result) throw new Error(name + ': ' + JSON.stringify(detail)); };
await fs.mkdir(path.join(root, 'evidence/testing/v3'), { recursive: true });
try {
  const protocol = { app_version: APP_VERSION, schema_version: SCHEMA_VERSION, protocol_version: PROTOCOL_VERSION, project_id: PROJECT_ID, official_title: OFFICIAL_TITLE, parameters: PARAMS, tasks: TASKS, coefficients: COEFFICIENTS, questions: QUESTIONS };
  await fs.writeFile(path.join(root, 'app/protocol.json'), JSON.stringify(protocol, null, 2) + '\n');
  assert('90_second_identical_task_plan', TASKS.reduce((sum, task) => sum + task.duration_ms, 0) === 90000);
  const lock = JSON.parse(await fs.readFile(path.join(root, 'evidence/dependency_lock.json'), 'utf8'));
  for (const item of lock.files) assert('dependency_' + item.path, hash(await fs.readFile(path.join(root, item.path))) === item.sha256);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'app/model_manifest.json'), 'utf8'));
  const glb = await fs.readFile(path.join(root, 'app', manifest.asset_path));
  assert('model_binary_hash', hash(glb) === manifest.sha256);
  assert('valid_glb_header', glb.readUInt32LE(0) === 0x46546c67 && glb.readUInt32LE(4) === 2 && glb.readUInt32LE(8) === glb.length);
  const jsonSize = glb.readUInt32LE(12);
  const model = JSON.parse(glb.subarray(20, 20 + jsonSize).toString());
  const binaryStart = 20 + jsonSize + 8;
  const actualNames = [...new Set(model.meshes.flatMap(mesh => mesh.extras?.targetNames || []))];
  assert('actual_morph_target_names', COEFFICIENTS.every(key => actualNames.includes(manifest.mapping[key])), actualNames);
  assert('no_example_animation', !model.animations?.length && manifest.automatic_animation === false);
  const morphChecks = [];
  for (const coefficient of COEFFICIENTS) {
    let nonzero = 0;
    for (const mesh of model.meshes) {
      const index = mesh.extras?.targetNames?.indexOf(manifest.mapping[coefficient]) ?? -1;
      if (index < 0) continue;
      const accessor = model.accessors[mesh.primitives[0].targets[index].POSITION];
      const view = model.bufferViews[accessor.bufferView];
      const start = binaryStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
      for (let i = 0; i < accessor.count * 3; i++) if (Math.abs(glb.readFloatLE(start + i * 4)) > 1e-7) nonzero++;
    }
    assert('real_nonzero_morph_' + coefficient, nonzero > 0, { changed_components: nonzero });
    morphChecks.push({ coefficient, changed_components: nonzero });
  }
  const inspection = { inspected_at: new Date().toISOString(), asset: 'app/' + manifest.asset_path, sha256: manifest.sha256, mesh_count: model.meshes.length, actual_morph_names: actualNames, mapping: manifest.mapping, animation_clip_count: model.animations?.length || 0, animation_playback_enabled: false, morph_checks: morphChecks, meshes: model.meshes.map(mesh => ({ name: mesh.name, morph_names: mesh.extras?.targetNames || [] })) };
  await fs.writeFile(path.join(root, 'evidence/model_inspection_v3.json'), JSON.stringify(inspection, null, 2) + '\n');
  const sourceFiles = (await fs.readdir(path.join(root, 'app'))).filter(name => name.endsWith('.js'));
  for (const name of sourceFiles) { const checked = spawnSync(process.execPath, ['--check', path.join(root, 'app', name)], { encoding: 'utf8' }); assert('syntax_' + name, checked.status === 0, checked.stderr || null); }
  const html = await fs.readFile(path.join(root, 'app/index.html'), 'utf8');
  assert('local_three_import_map', html.includes('"three":"./vendor/three.module.js"'));
  assert('no_remote_page_assets', !/(?:src|href)=["']https?:\/\//.test(html));
  if (process.argv.includes('--package')) {
    const destination = path.join(root, 'delivery/IPP31078-prototype-v0.3.0');
    try { const existing = await fs.readFile(path.join(destination, 'data/raw/participants.csv'), 'utf8'); if (existing.trim().split(/\r?\n/).length > 1) throw new Error('交付目录已有采集数据，请先完整归档，构建不会覆盖该记录表。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(destination, { recursive: true });
    await fs.cp(path.join(root, 'app'), path.join(destination, 'app'), { recursive: true });
    await fs.mkdir(path.join(destination, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(destination, 'tests'), { recursive: true });
    for (const name of await fs.readdir(path.join(root, 'tests'))) if (/\.(?:py|mjs|cjs)$/.test(name)) await fs.copyFile(path.join(root, 'tests', name), path.join(destination, 'tests', name));
    for (const name of ['serve.py', 'session_data.py', 'evidence_registry.py', 'video_tools.py', 'analyze.py', 'evaluate.py', 'runtime_paths.py', 'install.py', 'fetch_assets.py', 'import_demo.py', 'build.mjs', 'create_avatar.mjs']) await fs.copyFile(path.join(root, 'scripts', name), path.join(destination, 'scripts', name));
    for (const name of ['README.md', 'launch.py', '启动_笔记本.command', '启动_笔记本_Windows.bat', '评估分析.command', '启动原型.command', '安装环境.command', '运行分析.command', '构建检查.command', 'requirements-analysis.txt', 'analysis-requirements.lock.txt']) await fs.copyFile(path.join(root, name), path.join(destination, name));
    await fs.cp(path.join(root, 'portable'), path.join(destination, 'portable'), { recursive: true });
    await fs.cp(path.join(root, 'templates'), path.join(destination, 'templates'), { recursive: true });
    for (const folder of ['data/raw', 'data/processed', 'evidence', 'media/raw', 'media/output', 'materials']) await fs.mkdir(path.join(destination, folder), { recursive: true });
    for (const name of ['experience_protocol.md', 'operator_guide.md', 'data_dictionary.md', 'questionnaire_blank.md', 'evaluation_protocol.md', 'video_metric_annotations.csv']) await fs.copyFile(path.join(root, 'materials', name), path.join(destination, 'materials', name));
    for (const name of ['data/raw/participants.csv', 'materials/engineering_acceptance.csv']) { const header = (await fs.readFile(path.join(root, name), 'utf8')).split(/\r?\n/)[0]; await fs.writeFile(path.join(destination, name), header + '\r\n'); }
    await fs.copyFile(path.join(root, 'evidence/dependency_lock.json'), path.join(destination, 'evidence/dependency_lock.json'));
    await fs.copyFile(path.join(root, 'ASSET_SOURCES.md'), path.join(destination, 'ASSET_SOURCES.md'));
    for (const name of ['启动原型.command', '安装环境.command', '运行分析.command', '构建检查.command']) await fs.chmod(path.join(destination, name), 0o755);
    assert('portable_package_created', true, 'delivery/IPP31078-prototype-v0.3.0');
  }
  const report = { built_at: new Date().toISOString(), app_version: APP_VERSION, protocol_version: PROTOCOL_VERSION, overall: 'passed', check_count: checks.length, checks, build_type: 'offline_static_assets_with_local_python_service', packaged: process.argv.includes('--package') };
  await fs.writeFile(path.join(root, 'evidence/testing/v3/build_report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ overall: report.overall, checks: checks.length, model_morphs: actualNames, packaged: report.packaged }, null, 2));
} catch (error) { await fs.writeFile(path.join(root, 'evidence/testing/v3/build_report.json'), JSON.stringify({ overall: 'failed', checks, error: error.stack }, null, 2) + '\n'); console.error(error.stack); process.exitCode = 1; }
