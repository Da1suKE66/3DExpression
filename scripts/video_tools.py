from pathlib import Path
import os
import re
import shutil
import subprocess
from runtime_paths import ROOT

def ffmpeg_path():
    supplied = os.environ.get('IPP31078_FFMPEG')
    if supplied and Path(supplied).is_file():
        return supplied
    normal = shutil.which('ffmpeg')
    if normal:
        return normal
    candidates = sorted((ROOT / '.analysis_deps/imageio_ffmpeg/binaries').glob('ffmpeg-*'))
    return str(next((path for path in candidates if path.is_file() and os.access(path, os.X_OK)), '')) or None

def inspect_video(path):
    executable = ffmpeg_path()
    if not executable:
        return {'duration_s': None, 'validation': 'manual_duration_check_required', 'decoded_frames': None}
    command = [executable, '-nostdin', '-v', 'error', '-i', str(path), '-map', '0:v:0', '-an', '-progress', 'pipe:1', '-f', 'null', '-']
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError('录像无法解码：' + result.stderr[-500:])
    times = re.findall(r'^out_time_us=(\d+)$', result.stdout, re.M)
    frames = re.findall(r'^frame=(\d+)$', result.stdout, re.M)
    if not times or not frames or int(frames[-1]) < 1:
        raise ValueError('录像未包含可解码视频帧')
    return {'duration_s': int(times[-1]) / 1_000_000, 'decoded_frames': int(frames[-1]), 'validation': 'local_ffmpeg_full_decode', 'tool': Path(executable).name}

def ensure_mp4(source, destination, mime):
    if mime.startswith('video/mp4'):
        with Path(source).open('rb') as handle:
            header = handle.read(12)
        if len(header) < 12 or header[4:8] != b'ftyp':
            raise ValueError('声明为MP4的文件缺少有效文件头')
        shutil.copyfile(source, destination)
        return 'native_browser_mp4'
    executable = ffmpeg_path()
    if not executable:
        raise ValueError('当前浏览器只提供WebM，尚未安装本地转换工具；运行安装环境.command后重试，原始录像可先下载备份')
    result = subprocess.run([executable, '-nostdin', '-v', 'error', '-i', str(source), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '20', '-movflags', '+faststart', '-n', str(destination)], capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise ValueError('MP4转换失败：' + result.stderr[-500:])
    return 'local_webm_to_mp4_h264'
