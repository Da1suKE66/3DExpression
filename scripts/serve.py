"""Loopback-only offline app and append-only exports; raw and synthetic stay separate."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, unquote
from uuid import uuid4
import argparse
import csv
import hashlib
import json
import tempfile
import threading
import subprocess

from evidence_registry import register
from session_data import validate_session, validate_tracking, validate_evaluation, PARTICIPANT_COLUMNS, PROTOCOL, MODEL, AVATAR_CATALOG
from video_tools import ensure_mp4, inspect_video, ffmpeg_path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
STORE_LOCK = threading.RLock()

def append_questionnaires(root, data):
    if data['source_type'] != 'live_camera' or data['status'] != 'complete':
        return []
    if data['protocol_version'] != PROTOCOL['protocol_version']:
        return ['旧协议JSON已另存，历史问卷表保持不变；请使用相应旧版分析程序']
    table = root / ('data/raw/participants_v5.csv' if data['protocol_version'] == PROTOCOL['protocol_version'] else 'data/raw/participants.csv')
    warnings = []
    with STORE_LOCK:
        existing, fields = [], list(PARTICIPANT_COLUMNS)
        if table.exists():
            with table.open(encoding='utf-8-sig', newline='') as handle:
                reader = csv.DictReader(handle); fields = reader.fieldnames or []
                existing = list(reader)
            if not set(PARTICIPANT_COLUMNS).issubset(fields):
                return ['participants.csv表头不匹配，未修改该表；完整JSON已保存，可据此分析']
        for rating in data['ratings']:
            old = [row for row in existing if row.get('session_id') == data['session_id'] and row.get('condition') == rating['condition']]
            row = {key: str(rating.get(key, '')) for key in fields}
            if old:
                if any(any(oldrow.get(key, '') != row.get(key, '') for key in PARTICIPANT_COLUMNS) for oldrow in old):
                    warnings.append('表中已有同会话不同评分，未覆盖；请核对重复或修改记录')
                continue
            existing.append(row)
        table.parent.mkdir(parents=True, exist_ok=True)
        temp = table.with_suffix('.csv.tmp')
        with temp.open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader(); writer.writerows(existing)
        temp.replace(table)
        register('PARTICIPANTS-V5-TABLE' if data['protocol_version'] == PROTOCOL['protocol_version'] else 'PARTICIPANTS-TABLE', 'data', table, 'real_live_camera_questionnaires_and_manual_table', 'questionnaire_records_not_independently_verified', 'pending_manual_verification', 'yes', '仅完整实时会话追加；内部与探索性用途分开，重复导出不重复追加。', root=root)
    return warnings

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.glb': 'model/gltf-binary'}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)
    def allowed_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')
    def json_response(self, code, payload):
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(encoded))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(encoded)
    def end_headers(self):
        if not urlsplit(self.path).path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff'); self.send_header('Referrer-Policy', 'no-referrer'); self.send_header('Permissions-Policy', 'camera=(self), microphone=()'); super().end_headers()
    def list_directory(self, path):
        self.send_error(404); return None
    def do_GET(self):
        if not self.allowed_host():
            return self.json_response(403, {'error': '仅允许本机回环地址'})
        route = unquote(urlsplit(self.path).path)
        if route == '/api/health':
            paths = ['vendor/three.module.js', 'vendor/addons/loaders/GLTFLoader.js', 'vendor/addons/utils/BufferGeometryUtils.js', 'vendor/vision_bundle.mjs', 'models/face_landmarker.task', MODEL['asset_path'], 'model_manifest.json', 'protocol.json', 'vendor/wasm/vision_wasm_internal.wasm', 'vendor/wasm/vision_wasm_internal.js', 'vendor/wasm/vision_wasm_nosimd_internal.js', 'vendor/wasm/vision_wasm_nosimd_internal.wasm']
            paths.extend(['avatar_catalog.json', *[model['asset_path'] for model in AVATAR_CATALOG['avatars']]])
            missing = [name for name in paths if not (APP / name).is_file()]
            return self.json_response(200 if not missing else 503, {'project_id': 'IPP31078', 'version': PROTOCOL['app_version'], 'protocol_version': PROTOCOL['protocol_version'], 'offline_assets_ready': not missing, 'missing': missing, 'video_conversion_available': bool(ffmpeg_path()), 'real_camera_validation': 'pending_manual_acceptance'})
        if route == '/api/protocol':
            return self.json_response(200, PROTOCOL)
        requested = (APP / route.lstrip('/')).resolve()
        if not requested.is_relative_to(APP) or any(part.startswith('.') for part in Path(route).parts if part not in ('/', '.', '..')):
            self.send_error(404); return
        super().do_GET()
    def do_HEAD(self):
        if not self.allowed_host():
            return self.json_response(403, {'error': '仅允许本机回环地址'})
        route = unquote(urlsplit(self.path).path)
        if not (APP / route.lstrip('/')).resolve().is_relative_to(APP):
            self.send_error(404); return
        super().do_HEAD()
    def do_POST(self):
        if not self.allowed_host() or self.headers.get('Origin') not in (None, f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'):
            return self.json_response(403, {'error': '只接受同源本机保存请求'})
        route = urlsplit(self.path).path
        if route == '/api/demo-video':
            return self.save_video()
        if route not in ('/api/sessions', '/api/tracking', '/api/evaluations'):
            return self.json_response(404, {'error': '未知接口'})
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self.json_response(415, {'error': '须发送application/json'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            limit_mb = 128 if route == '/api/sessions' else 32
            if not 0 < size <= limit_mb * 1024 * 1024:
                return self.json_response(413, {'error': f'记录为空或超过{limit_mb}MB'})
            data = json.loads(self.rfile.read(size), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
            errors = validate_session(data) if route == '/api/sessions' else validate_evaluation(data) if route == '/api/evaluations' else validate_tracking(data)
            if errors:
                return self.json_response(422, {'error': '；'.join(errors)})
            root = Path(getattr(self.server, 'project_root', ROOT))
            export_id = str(uuid4()); synthetic = data['source_type'] == 'synthetic_test'
            folder = ('evidence/testing/v5/sessions' if data['protocol_version'] == PROTOCOL['protocol_version'] else 'evidence/testing/v3/sessions') if synthetic else 'data/raw/evaluations' if route == '/api/evaluations' else 'data/raw/live_sessions' if route == '/api/sessions' else 'data/raw/tracking'
            destination = root / folder / (data['session_id'] + '_' + export_id[:8] + '.json')
            destination.parent.mkdir(parents=True, exist_ok=True)
            with STORE_LOCK:
                with destination.open('x', encoding='utf-8') as handle:
                    json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False); handle.write('\n')
                eid = ('SYNTHETIC-' if synthetic else 'LIVE-DATA-') + export_id
                register(eid, 'test' if synthetic else 'data', destination, data['source_type'], data['record_type'], 'synthetic_excluded_from_research' if synthetic else 'pending_manual_verification', 'no' if synthetic else 'yes', '结构校验不证明真人操作。来源不能由回放改写为live_camera。', root=root)
                warnings = append_questionnaires(root, data) if route == '/api/sessions' else []
            return self.json_response(201, {'path': str(destination.relative_to(root)), 'evidence_id': eid, 'source_type': data['source_type'], 'warnings': warnings})
        except (ValueError, TypeError, UnicodeDecodeError, OverflowError) as error:
            return self.json_response(400, {'error': '记录无效：' + str(error)})
        except OSError as error:
            return self.json_response(500, {'error': '本机写入失败：' + str(error)})
    def save_video(self):
        try:
            size = int(self.headers.get('Content-Length', '0')); mime = self.headers.get('Content-Type', '')
            meta = json.loads(unquote(self.headers.get('X-Recording-Metadata', '{}')))
            if not isinstance(meta, dict):
                raise ValueError('录像元信息必须为JSON对象')
            if not 0 < size <= 160 * 1024 * 1024:
                return self.json_response(413, {'error': '录像为空或超过160MB'})
            if not mime.startswith(('video/mp4', 'video/webm')) or meta.get('source_type') != 'live_camera' or not isinstance(meta.get('duration_ms'), (int, float)) or not 20000 <= meta['duration_ms'] <= 1800000:
                return self.json_response(422, {'error': '需至少20秒的live_camera连续录像；参数回放或软件测试不能保存为真人演示'})
            root = Path(getattr(self.server, 'project_root', ROOT)); raw = root / 'media/raw'; raw.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='ipp31078_video_') as temp:
                source = Path(temp) / 'browser_capture.bin'; converted = Path(temp) / 'capture.mp4'
                source.write_bytes(self.rfile.read(size))
                conversion = ensure_mp4(source, converted, mime)
                inspection = inspect_video(converted)
                if inspection['duration_s'] is not None and inspection['duration_s'] < 20:
                    return self.json_response(422, {'error': f"实际录像只有{inspection['duration_s']:.2f}秒，请连续录制22–25秒后重试"})
                stamp = datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d_%H%M%S')
                with STORE_LOCK:
                    destination = raw / '01_live.mp4'
                    if destination.exists():
                        destination = raw / ('01_live_' + stamp + '_' + str(uuid4())[:6] + '.mp4')
                    with destination.open('xb') as handle:
                        handle.write(converted.read_bytes())
                    digest = hashlib.sha256(destination.read_bytes()).hexdigest(); eid = 'LIVE-VIDEO-' + str(uuid4())
                    metadata = {**meta, 'saved_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'), 'path': str(destination.relative_to(root)), 'sha256': digest, 'conversion': conversion, 'media_validation': inspection, 'authenticity': 'pending_manual_review_of_live_camera_claim'}
                    sidecar = destination.with_suffix('.metadata.json'); sidecar.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                    register(eid, 'video', destination, 'user_initiated_live_camera_composite_recording', 'continuous_avatar_and_camera_demonstration', 'pending_manual_verification', 'yes', '需操作者核对真实连续画面和动作响应；不作为问卷样本。', root=root)
                    register(eid + '-META', 'document', sidecar, eid, 'recording_source_duration_and_hash', 'pending_manual_verification', 'yes', root=root)
            return self.json_response(201, {'path': str(destination.relative_to(root)), 'evidence_id': eid, 'duration_s': inspection['duration_s']})
        except (ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
            return self.json_response(422, {'error': str(error)})

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--port', type=int, default=8765); args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as error:
        raise SystemExit('无法启动：' + str(error) + '。可用 --port 指定其他端口；关闭旧版服务后再启动。')
    print(f"IPP31078 v{PROTOCOL['app_version']} / {PROTOCOL['protocol_version']}: http://127.0.0.1:{args.port}", flush=True)
    print('真实摄像头待人工验收；所有运行资产在本机，Ctrl+C停止。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
