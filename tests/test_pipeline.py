"""All fabricated fixtures below are unit-test inputs confined to temporary projects."""
from pathlib import Path
import copy
import csv
import json
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from session_data import validate_session, COEFFICIENTS, QUESTIONS, PARAMS, MODEL, PROTOCOL, PARTICIPANT_COLUMNS
from analyze import run, engineering_metrics
from evidence_registry import register

def fixture(pid='TEST01',kind='exploratory',source='live_camera',a=6,b=2):
    sid=str(uuid4());at='2026-11-07T01:00:00+08:00'
    data={'record_type':'study_session','schema_version':PROTOCOL['schema_version'],'project_id':'IPP31078','app_version':PROTOCOL['app_version'],'protocol_version':PROTOCOL['protocol_version'],'session_id':sid,'participant_id':pid,'record_kind':kind,'source_type':source,'consent':True,'started_at':at,'ended_at':at,'exported_at':at,'condition_order':['A','B'],'parameters':copy.deepcopy(PARAMS),'model_info':{'id':MODEL['id'],'sha256':MODEL['sha256'],'animation_playback_enabled':False},'calibration':{'status':'complete','sample_count':40,'duration_ms':3000,'baseline':{key:0.02 for key in COEFFICIENTS},'source_type':source},'status':'complete','conditions':[],'frames':[],'ratings':[],'events':[]}
    for index,condition in enumerate(['A','B'],1):
        data['conditions'].append({'condition':condition,'block_index':index,'active_ms':90000,'status':'completed'})
        for step in range(4):
            frame={'session_id':sid,'participant_id':pid,'source_type':source,'condition':condition,'block_index':index,'captured_at':at,'monotonic_ms':index*100000+step*50,'active_ms':step*50,'detected':1,'paused':0,'sample_kind':'result','inference_ms':8,'render_fps':60,'tracking_update_hz':20,'avatar_update_hz':20,'pose_valid':False,**{'raw_pose_'+axis:None for axis in ['pitch','yaw','roll']},**{'applied_pose_'+axis:0 for axis in ['pitch','yaw','roll']}}
            for key in COEFFICIENTS:frame['raw_'+key]=0.5;frame['corrected_'+key]=0.45;frame['applied_'+key]=0 if condition=='A' else 0.4
            data['frames'].append(frame)
        data['ratings'].append({'participant_id':pid,'session_id':sid,'record_kind':kind,'source_type':source,'protocol_version':PROTOCOL['protocol_version'],'condition_order':'AB','condition':condition,'block_index':index,'submitted_at':at,**{key:a if condition=='A' else b for key in QUESTIONS},'comment':'SYNTHETIC UNIT FIXTURE IN TEMPORARY DIRECTORY ONLY'})
    return data

def write_table(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=PARTICIPANT_COLUMNS,extrasaction='ignore');writer.writeheader();writer.writerows(rows)

class PipelineTests(unittest.TestCase):
    def evaluate(self,records=(),rows=(),manual_rows=()):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name);raw=root/'data/raw';raw.mkdir(parents=True)
        for index,data in enumerate(records):(raw/f'fixture-{index}.json').write_text(json.dumps(data))
        write_table(raw/'participants.csv',rows)
        if manual_rows:
            table=root/'materials/engineering_acceptance.csv';table.parent.mkdir(parents=True)
            fields=['record_id','source_type','started_at','action','requested_repetitions','operator_observed_repetitions','visual_response','tracking_loss_notes','observed_render_fps','observed_result_hz','continuous_duration_s','operator','notes']
            with table.open('w',encoding='utf-8-sig',newline='') as handle:
                writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader();writer.writerows(manual_rows)
        return run(raw,root/'data/processed',root,render=False)

    def test_static_A_and_missing_face_constraints(self):
        data=fixture();self.assertEqual(validate_session(data),[]);data['frames'][0]['applied_jawOpen']=0.5;self.assertTrue(validate_session(data))
        data=fixture();data['frames'][0]['detected']=0;self.assertTrue(validate_session(data))

    def test_locked_parameters_calibration_and_replay_source(self):
        for field,value in [('source_type','recorded_tracking'),('consent',False)]:
            data=fixture();data[field]=value;self.assertTrue(validate_session(data))
        data=fixture();data['parameters']['smoothing_tau_ms']=150;self.assertTrue(validate_session(data))
        data=fixture();data['calibration']['sample_count']=5;self.assertTrue(validate_session(data))

    def test_malformed_fields_return_errors_instead_of_crashing(self):
        for field,value in [('frames',None),('condition_order',None),('calibration',[]),('ratings',[None]),('model_info',[])]:
            data=fixture();data[field]=value;self.assertTrue(validate_session(data))

    def test_empty_inputs_have_no_people_or_effects(self):
        result=self.evaluate();self.assertEqual(result['status'],'no_real_data');self.assertEqual(result['actual_counts']['complete_external_pairs'],0)
        self.assertIsNone(result['external_item_descriptions']['control']['A']['mean']);self.assertEqual(result['included_pairs'],[])

    def test_negative_pair_differences_are_retained(self):
        result=self.evaluate([fixture(a=6,b=2)]);self.assertEqual(result['actual_counts']['complete_external_pairs'],1)
        self.assertEqual(result['external_item_descriptions']['control']['B_minus_A']['mean'],-4)

    def test_synthetic_and_replay_are_excluded_even_if_in_raw(self):
        fake=fixture(source='synthetic_test');replay=fixture(source='recorded_tracking')
        result=self.evaluate([fake,replay],fake['ratings']);self.assertEqual(result['actual_counts']['unique_declared_live_anonymous_ids'],0);self.assertEqual(result['engineering_metrics'],[])
        self.assertIn('synthetic_test',result['actual_counts']['excluded_source_counts'])

    def test_duplicate_reexport_and_matching_csv_do_not_inflate_people(self):
        first=fixture();later=copy.deepcopy(first);later['exported_at']='2026-11-07T02:00:00+08:00'
        result=self.evaluate([first,later],first['ratings']);self.assertEqual(result['actual_counts']['complete_external_pairs'],1)
        self.assertTrue(any(issue['code']=='duplicate_export_merged' for issue in result['validation_issues']))

    def test_repeated_id_with_two_sessions_is_held_for_review(self):
        result=self.evaluate([fixture('TEST01'),fixture('TEST01')]);self.assertEqual(result['actual_counts']['complete_external_pairs'],0)
        self.assertTrue(any(issue['code']=='duplicate_participant_sessions' for issue in result['validation_issues']))

    def test_duplicate_csv_condition_missing_condition_and_out_of_range_are_flagged(self):
        data=fixture();rows=[data['ratings'][0],data['ratings'][0]];result=self.evaluate(rows=rows);self.assertEqual(result['included_pairs'],[])
        self.assertTrue(any(issue['code']=='duplicate_csv_condition' for issue in result['validation_issues']))
        result=self.evaluate(rows=[fixture('TEST02')['ratings'][0]]);self.assertTrue(any(issue['code']=='missing_condition' for issue in result['validation_issues']))
        data=fixture('TEST03');data['ratings'][0]['control']=8;result=self.evaluate(rows=data['ratings']);self.assertEqual(result['included_pairs'],[]);self.assertTrue(any(issue['code']=='invalid_rating' for issue in result['validation_issues']))

    def test_conflicting_csv_and_json_are_not_silently_resolved(self):
        data=fixture();rows=copy.deepcopy(data['ratings']);rows[0]['control']=1;result=self.evaluate([data],rows);self.assertEqual(result['included_pairs'],[])

    def test_internal_ratings_never_become_external_participants(self):
        result=self.evaluate([fixture(kind='internal')]);self.assertEqual(result['actual_counts']['complete_external_pairs'],0);self.assertEqual(result['actual_counts']['complete_internal_pairs'],1)

    def test_rates_are_timestamp_based_not_inverse_inference_time(self):
        metrics=engineering_metrics(fixture());self.assertEqual(metrics[0]['result_update_hz'],20);self.assertEqual(metrics[0]['inference_ms_median'],8)
        self.assertNotEqual(metrics[0]['result_update_hz'],1000/metrics[0]['inference_ms_median'])

    def test_registration_requires_existing_inside_project_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with self.assertRaises(ValueError):register('NO','test',root/'absent','fixture','fixture','test',root=root)
            with self.assertRaises(ValueError):register('OUT','test',Path(__file__),'fixture','fixture','test',root=root)

    def test_manual_engineering_observations_are_not_people_or_questionnaire_scores(self):
        row={'record_id':'TEST-ENG-01','source_type':'live_camera','started_at':'2026-11-07T01:00:00+08:00','action':'jaw','requested_repetitions':5,'operator_observed_repetitions':3,'visual_response':'SYNTHETIC UNIT FIXTURE: partial response','tracking_loss_notes':'temporary fixture','observed_render_fps':30,'observed_result_hz':15,'continuous_duration_s':180,'operator':'UNIT TEST','notes':'NOT HUMAN DATA'}
        result=self.evaluate(manual_rows=[row]);self.assertEqual(result['actual_counts']['manual_engineering_observation_rows'],1);self.assertEqual(result['actual_counts']['complete_external_pairs'],0);self.assertEqual(result['manual_engineering_observations'][0]['operator_observed_repetitions'],3)
        row['source_type']='synthetic_test';result=self.evaluate(manual_rows=[row]);self.assertEqual(result['actual_counts']['manual_engineering_observation_rows'],0)

    def test_short_csv_row_with_missing_source_is_flagged_without_crashing(self):
        data=fixture();row=data['ratings'][0].copy();row['source_type']=None
        result=self.evaluate(rows=[row]);self.assertEqual(result['included_pairs'],[]);self.assertTrue(any(issue['code']=='excluded_source' for issue in result['validation_issues']))

if __name__=='__main__':unittest.main(verbosity=2)
