"""Synthetic interface/media fixtures are confined to temporary roots, never project raw."""
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from urllib.parse import quote
import csv
import json
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from serve import Handler
from session_data import PROTOCOL, AVATAR_CATALOG
from video_tools import ffmpeg_path,inspect_video
from test_pipeline import fixture

class QuietHandler(Handler):
    def log_message(self,*args):pass

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);self.server.project_root=self.root;self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.base=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def request(self,route,data=None,headers=None):
        body=data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
        request=Request(self.base+route,data=body,headers=headers or ({'Content-Type':'application/json'} if body else {}))
        try:response=urlopen(request,timeout=30)
        except HTTPError as error:response=error
        with response:return response.status,response.read()
    def test_health_local_glb_and_private_paths(self):
        code,body=self.request('/api/health');self.assertEqual(code,200);self.assertEqual(json.loads(body)['version'],PROTOCOL['app_version'])
        
        for model in AVATAR_CATALOG['avatars']:self.assertEqual(self.request('/'+model['asset_path'])[0],200)
        self.assertEqual(self.request('/../project_meta.json')[0],404);self.assertEqual(self.request('/vendor/')[0],404)
    def test_append_only_save_and_idempotent_questionnaire_rows(self):
        data=fixture()
        for _ in range(2):self.assertEqual(self.request('/api/sessions',data)[0],201)
        self.assertEqual(len(list((self.root/'data/raw/live_sessions').glob('*.json'))),2)
        with (self.root/'data/raw/participants_v5.csv').open(encoding='utf-8-sig') as handle:self.assertEqual(len(list(csv.DictReader(handle))),3)
    def test_new_save_never_rewrites_historical_table(self):
        old=self.root/'data/raw/participants.csv';old.parent.mkdir(parents=True);old.write_bytes(b'HISTORICAL TEST SENTINEL DO NOT MODIFY\r\n')
        v4=old.parent/'participants_v4.csv';v4.write_bytes(b'HISTORICAL V4 KEEP BYTES\r\n')
        before=old.read_bytes();self.assertEqual(self.request('/api/sessions',fixture())[0],201)
        self.assertEqual(old.read_bytes(),before);self.assertEqual(v4.read_bytes(),b'HISTORICAL V4 KEEP BYTES\r\n');self.assertTrue((old.parent/'participants_v5.csv').exists())
    def test_new_save_rejects_incomplete_six_item_questionnaire(self):
        d=fixture();d['ratings'][0].pop('ownership');self.assertEqual(self.request('/api/sessions',d)[0],422)
        self.assertFalse((self.root/'data/raw').exists())
    def test_synthetic_storage_is_outside_real_raw(self):
        code,body=self.request('/api/sessions',fixture(source='synthetic_test'));self.assertEqual(code,201);self.assertIn('evidence/testing/v5/sessions',json.loads(body)['path'].replace('\\','/'));self.assertFalse((self.root/'data/raw').exists())
    def test_source_and_origin_guards(self):
        self.assertEqual(self.request('/api/sessions',fixture(source='recorded_tracking'))[0],422)
        self.assertEqual(self.request('/api/sessions',{}, {'Content-Type':'application/json','Origin':'https://example.invalid'})[0],403)
    def test_malformed_and_unconsented_requests_leave_no_raw_files(self):
        data=fixture();data['consent']=False;self.assertEqual(self.request('/api/sessions',data)[0],422)
        self.assertEqual(self.request('/api/sessions',b'{',{'Content-Type':'application/json'})[0],400);self.assertFalse((self.root/'data/raw').exists())
    def test_video_rejects_synthetic_and_short_claims(self):
        meta={'source_type':'synthetic_test','duration_ms':25000}
        self.assertEqual(self.request('/api/demo-video',b'not a real video',{'Content-Type':'video/mp4','X-Recording-Metadata':quote(json.dumps(meta))})[0],422)
        self.assertFalse((self.root/'media/raw').exists())
    def test_real_codec_and_video_save_pipeline_with_temporary_synthetic_file(self):
        executable=ffmpeg_path()
        if not executable:self.skipTest('optional local ffmpeg not installed')
        video=self.root/'SYNTHETIC_CODEC_TEST.mp4'
        result=subprocess.run([executable,'-nostdin','-v','error','-f','lavfi','-i','color=c=gray:s=160x120:r=10:d=21','-an','-c:v','libx264','-pix_fmt','yuv420p',str(video)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertGreaterEqual(inspect_video(video)['duration_s'],20)
        meta={'source_type':'live_camera','duration_ms':21000,'test_fixture_note':'SYNTHETIC FILE IN TEMPORARY PROJECT ONLY'}
        code,body=self.request('/api/demo-video',video.read_bytes(),{'Content-Type':'video/mp4','X-Recording-Metadata':quote(json.dumps(meta))})
        self.assertEqual(code,201,body);self.assertTrue((self.root/'media/raw/01_live.mp4').exists())

if __name__=='__main__':unittest.main(verbosity=2)
