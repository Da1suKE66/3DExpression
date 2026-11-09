"""Explicitly fabricated fixtures in temporary directories; never project raw data."""
from pathlib import Path
import copy
import csv
import hashlib
import json
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from session_data import validate_tracking, validate_evaluation, LEGACY_PROTOCOL, LEGACY_MODEL
from evaluate import load_records, summarize_record, video_annotations, run
from test_pipeline import fixture

def evaluation_fixture(source='live_camera'):
    tracking=fixture(source=source)
    tracking.update(record_type='tracking_recording',record_kind='engineering',duration_ms=12000,start_monotonic_ms=0,end_monotonic_ms=12000)
    sid=tracking['session_id']; neutral_id=str(uuid4());jaw_id=str(uuid4())
    template=tracking['frames'][-1];tracking['frames']=[]
    for i in range(240):
        f=copy.deepcopy(template);f.update(monotonic_ms=i*50,trial_id=neutral_id if i<200 else jaw_id,evaluation_action='neutral' if i<200 else 'jaw',expected_face_visible=True,active_ms=None,frame_to_render_submit_ms=10,video_present_to_render_submit_ms=8)
        for key in LEGACY_PROTOCOL['coefficients']:
            f['raw_'+key]=0.1+(0.01 if i%2 else 0);f['applied_'+key]=0.1
        tracking['frames'].append(f)
    at=tracking['started_at']
    trials=[{'trial_id':neutral_id,'action':'neutral','requested_repetitions':0,'started_at':at,'ended_at':at,'start_monotonic_ms':0,'end_monotonic_ms':10000,'status':'completed','observed_successes':None,'observation_method':None}, {'trial_id':jaw_id,'action':'jaw','requested_repetitions':5,'started_at':at,'ended_at':at,'start_monotonic_ms':10000,'end_monotonic_ms':12000,'status':'completed','observed_successes':None,'observation_method':None}]
    return {'record_type':'engineering_evaluation','schema_version':'1.0.0','evaluation_protocol':'IPP31078-EVAL-v1','source_type':source,'session_id':sid,'started_at':at,'ended_at':at,'exported_at':at,'status':'complete','tracking':tracking,'trials':trials,'render_count':1440,'visible_duration_ms':12000,'video_quality_start':{'total_video_frames':100,'dropped_video_frames':5},'video_quality_end':{'total_video_frames':400,'dropped_video_frames':8}}

def item_for(data):
    return {'record':data['tracking'],'evaluation':data,'path':'TEMP_SYNTHETIC_FIXTURE.json','sha256':'fixture_only'}

class EvaluationTests(unittest.TestCase):
    def test_current_schema_and_metadata_validate(self):
        self.assertEqual(validate_evaluation(evaluation_fixture()),[])
    def test_legacy_tracking_remains_valid_without_new_coefficients(self):
        data=evaluation_fixture()['tracking'];data.update(schema_version=LEGACY_PROTOCOL['schema_version'],app_version=LEGACY_PROTOCOL['app_version'],protocol_version=LEGACY_PROTOCOL['protocol_version'],parameters=copy.deepcopy(LEGACY_PROTOCOL['parameters']),model_info={**LEGACY_MODEL,'animation_playback_enabled':False})
        for f in data['frames']:
            for key in list(f):
                if key.startswith(('raw_','corrected_','applied_')) and key.split('_',1)[1] not in LEGACY_PROTOCOL['coefficients']: del f[key]
        self.assertEqual(validate_tracking(data),[])
    def test_rates_and_browser_drop_use_actual_counters(self):
        report=summarize_record(item_for(evaluation_fixture()),[]);m={x['id']:x for x in report['metrics']}
        self.assertEqual(m['tracking_fps']['value'],20);self.assertEqual(m['rendering_fps']['value'],120);self.assertEqual(m['frame_drop_rate']['value'],0.01)
        self.assertEqual(m['tracking_success_rate']['value'],1)
    def test_compute_and_submission_times_never_fill_physical_latency(self):
        report=summarize_record(item_for(evaluation_fixture()),[]);m={x['id']:x for x in report['metrics']}
        for key in ['end_to_end_latency','expression_response_time','recovery_time']:self.assertIsNone(m[key]['value'])
        self.assertEqual(report['diagnostics']['pipeline_times']['frame_to_render_submit_ms']['median_ms'],10)
    def test_missing_counter_is_not_zero_drop(self):
        data=evaluation_fixture();data['video_quality_end']={'total_video_frames':100,'dropped_video_frames':5}
        m={x['id']:x for x in summarize_record(item_for(data),[])['metrics']};self.assertIsNone(m['frame_drop_rate']['value'])
    def test_unscored_trials_do_not_create_successes(self):
        m={x['id']:x for x in summarize_record(item_for(evaluation_fixture()),[])['metrics']};self.assertIsNone(m['action_response_success_rate']['value'])
        data=evaluation_fixture();data['trials'][1].update(observed_successes=0,observation_method='operator_visual_count')
        m={x['id']:x for x in summarize_record(item_for(data),[])['metrics']};self.assertEqual(m['action_response_success_rate']['value'],0)
        data['trials'][1]['observed_successes']=3
        m={x['id']:x for x in summarize_record(item_for(data),[])['metrics']};self.assertEqual(m['action_response_success_rate']['value'],0.6)
    def test_neutral_jitter_requires_stationary_trial(self):
        data=evaluation_fixture();m={x['id']:x for x in summarize_record(item_for(data),[])['metrics']};self.assertIsNotNone(m['expression_jitter']['value'])
        data['trials'][0]['action']='smile'
        m={x['id']:x for x in summarize_record(item_for(data),[])['metrics']};self.assertIsNone(m['expression_jitter']['value'])
    def test_actual_completion_event_duration_not_fixed_task_time(self):
        data=evaluation_fixture();m={x['id']:x for x in summarize_record(item_for(data),[])['metrics']};self.assertEqual(m['task_completion_time']['value'],2)
    def test_bad_observations_and_overlapping_trials_are_rejected(self):
        data=evaluation_fixture();data['trials'][1]['observed_successes']=6;self.assertTrue(validate_evaluation(data))
        data=evaluation_fixture();data['trials'][1]['start_monotonic_ms']=9000;self.assertTrue(validate_evaluation(data))
    def test_invalid_pose_and_malformed_evaluations_do_not_pass(self):
        data=evaluation_fixture();data['tracking']['frames'][0]['applied_pose_yaw']=3;self.assertTrue(validate_evaluation(data))
        for value in [None,[],1,'bad']:
            data=evaluation_fixture();data['tracking']['duration_ms']=value;self.assertTrue(validate_evaluation(data))
        data=evaluation_fixture();data['trials'][0]['action']=[];self.assertTrue(validate_evaluation(data))
    def test_source_filter_and_conflicting_duplicate_sessions(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);folder=root/'data/raw/evaluations';folder.mkdir(parents=True)
            data=evaluation_fixture(source='synthetic_test');(folder/'test.json').write_text(json.dumps(data))
            records,issues=load_records(root);self.assertEqual(records,[]);self.assertEqual(issues[0]['code'],'excluded_source')
            data=evaluation_fixture();(folder/'one.json').write_text(json.dumps(data));(folder/'two.json').write_text(json.dumps(data));records,issues=load_records(root);self.assertEqual(len(records),1)
            data['tracking']['frames'][0]['raw_jawOpen']=0.7;(folder/'two.json').write_text(json.dumps(data));records,issues=load_records(root);self.assertEqual(records,[])
    def test_empty_report_retains_twelve_metrics_as_pending_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            result=run(Path(temp));self.assertEqual(result['metric_count'],12);self.assertEqual(result['real_record_count'],0)
    def test_external_annotation_needs_hash_verified_capture_rate_and_session(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'media/raw').mkdir(parents=True);(root/'materials').mkdir()
            video=root/'media/raw/SYNTHETIC_TEST_BYTES.mp4';video.write_bytes(b'EXPLICIT TEMPORARY UNIT FIXTURE NOT A REAL VIDEO')
            row={'event_id':'TEST-ONLY-1','session_id':str(uuid4()),'source_type':'live_camera','metric':'end_to_end_latency','action':'jaw','recording_path':'media/raw/SYNTHETIC_TEST_BYTES.mp4','recording_sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'recording_scope':'external_face_and_display','actual_capture_fps':'240','capture_rate_verified':'yes','input_onset_frame':'10','output_onset_frame':'16','annotator':'UNIT_FIXTURE_ONLY'}
            p=root/'materials/video_metric_annotations.csv'
            def write():
                with p.open('w',newline='') as handle:w=csv.DictWriter(handle,fieldnames=list(row));w.writeheader();w.writerow(row)
            write();issues=[];valid=video_annotations(root,issues);self.assertEqual(valid[0]['delay_ms'],25);self.assertEqual(issues,[])
            row['capture_rate_verified']='no';write();self.assertEqual(video_annotations(root,[]),[])
            row['capture_rate_verified']='yes';row['recording_sha256']='wrong';write();self.assertEqual(video_annotations(root,[]),[])
    def test_browser_composite_annotation_cannot_be_physical_end_to_end(self):
        data=evaluation_fixture();annotation={'metric':'end_to_end_latency','session_id':data['session_id'],'physical':False,'delay_ms':10}
        m={x['id']:x for x in summarize_record(item_for(data),[annotation])['metrics']};self.assertIsNone(m['end_to_end_latency']['value'])

if __name__=='__main__':unittest.main(verbosity=2)
