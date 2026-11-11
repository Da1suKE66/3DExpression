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
from session_data import validate_session, COEFFICIENTS, QUESTIONS, PARAMS, MODEL, PROTOCOL, AVATAR_CATALOG, PARTICIPANT_COLUMNS
from analyze import run, engineering_metrics
from evidence_registry import register

def fixture(pid='TEST01',kind='exploratory',source='live_camera',a=6,b=2):
    sid=str(uuid4());at='2026-11-07T01:00:00+08:00';conditions=['A_prerecorded','B_realtime','C_delayed']
    data={'record_type':'study_session','schema_version':PROTOCOL['schema_version'],'project_id':'IPP31078','app_version':PROTOCOL['app_version'],'protocol_version':PROTOCOL['protocol_version'],'session_id':sid,'participant_id':pid,'record_kind':kind,'source_type':source,'consent':True,'started_at':at,'ended_at':at,'exported_at':at,'condition_order':conditions,'parameters':copy.deepcopy(PARAMS),'model_info':{'id':MODEL['id'],'sha256':MODEL['sha256'],'avatar_key':MODEL['key'],'catalog_id':AVATAR_CATALOG['id'],'animation_playback_enabled':False},'calibration':{'avatar_key':MODEL['key'],'model_sha256':MODEL['sha256'],'status':'complete','sample_count':40,'duration_ms':3000,'baseline':{key:0.02 for key in COEFFICIENTS},'source_type':source},'status':'complete','conditions':[],'frames':[],'ratings':[],'events':[]}
    data['prerecorded_stimulus']={'source_type':'live_camera','sha256':'a'*64,'donor_id':'STIMULUS01','session_id':str(uuid4()),'avatar_key':MODEL['key'],'model_sha256':MODEL['sha256'],'duration_ms':120000,'offset_ms':1000,'window_ms':60000,'independence_confirmed':True}
    data['question_items']=copy.deepcopy(PROTOCOL['questions']);data['task_plan']=copy.deepcopy(PROTOCOL['tasks'])
    data['preference']={'participant_id':pid,'session_id':sid,'condition_order':'ABC','selected_condition':'no_preference','submitted_at':at}
    for index,condition in enumerate(conditions,1):
        added=400 if condition=='C_delayed' else 0
        data['conditions'].append({'condition':condition,'block_index':index,'condition_position':index,'added_delay_ms':added,'active_ms':60000,'status':'completed'})
        for step in range(12):
            now=index*100000+step*50; ready=condition=='B_realtime' or (condition=='C_delayed' and step>=8)
            f={'session_id':sid,'participant_id':pid,'source_type':source,'condition':condition,'block_index':index,'condition_position':index,'added_delay_ms':added,'captured_at':at,'timestamp':at,'task':'adapt','task_id':'adapt','monotonic_ms':now,'active_ms':step*50,'detected':1,'tracking_valid':True,'paused':0,'sample_kind':'result','inference_ms':8,'render_fps':60,'tracking_fps':20,'tracking_update_hz':20,'avatar_update_hz':20,'camera_input_fps':25,'input_timestamp_ms':now,'input_available_at_ms':now+1,'pose_valid':False,**{'raw_pose_'+axis:None for axis in ['pitch','yaw','roll']},**{'applied_pose_'+axis:0 for axis in ['pitch','yaw','roll']}}
            for key in COEFFICIENTS:f.update({'raw_'+key:0.5,'corrected_'+key:0.45,'target_'+key:0.45,'live_filtered_'+key:0.4,'applied_'+key:0.3 if condition=='A_prerecorded' else 0.4 if ready else 0})
            f.update(protocol_version=PROTOCOL['protocol_version'],condition_order='ABC',prerecorded_sha256='a'*64 if condition=='A_prerecorded' else None,prerecorded_position_ms=1000+step*50 if condition=='A_prerecorded' else None,feedback_state='prerecorded' if condition=='A_prerecorded' else 'ready' if ready else 'warming_up',feedback_input_timestamp_ms=now-added if ready else None,feedback_buffer_enqueue_ms=now-added+1 if ready else None,feedback_applied_at_ms=now+1 if ready else None,actual_buffer_delay_ms=added if ready else None,feedback_processing_start_ms=now-added-8 if ready else None,software_latency_ms=added+9 if ready else None,normal_processing_ms=9 if ready else None)
            data['frames'].append(f)
        data['ratings'].append({'participant_id':pid,'session_id':sid,'record_kind':kind,'source_type':source,'protocol_version':PROTOCOL['protocol_version'],'condition_order':'ABC','condition':condition,'block_index':index,'condition_position':index,'added_delay_ms':added,'submitted_at':at,**{key:a if condition=='A_prerecorded' else b if condition=='B_realtime' else 3 for key in QUESTIONS},'comment':'SYNTHETIC UNIT FIXTURE IN TEMPORARY DIRECTORY ONLY','open_feedback':'SYNTHETIC UNIT FIXTURE IN TEMPORARY DIRECTORY ONLY','overall_preference':'no_preference'})
    return data


def write_table(path,rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=PARTICIPANT_COLUMNS,extrasaction='ignore');writer.writeheader();writer.writerows(rows)

class PipelineTests(unittest.TestCase):
    def test_nondefault_delay_is_saved_but_not_pooled_with_400ms(self):
        d=fixture();d['parameters']['added_delay_ms']=200
        for row in d['conditions']+d['ratings']:
            if row['condition']=='C_delayed':row['added_delay_ms']=200
        for row in d['frames']:
            if row['condition']!='C_delayed':continue
            row['added_delay_ms']=200;ready=row['active_ms']>=200;now=row['monotonic_ms']
            row.update(feedback_state='ready' if ready else 'warming_up',feedback_input_timestamp_ms=now-200 if ready else None,feedback_buffer_enqueue_ms=now-199 if ready else None,feedback_applied_at_ms=now+1 if ready else None,actual_buffer_delay_ms=200 if ready else None,feedback_processing_start_ms=now-208 if ready else None,software_latency_ms=209 if ready else None,normal_processing_ms=9 if ready else None)
            for key in COEFFICIENTS:row['applied_'+key]=0.4 if ready else 0
        self.assertEqual(validate_session(d),[])
        result=self.evaluate([d],d['ratings']);self.assertEqual(result['included_triplets'],[]);self.assertTrue(any(i['code']=='excluded_delay_configuration' for i in result['validation_issues']))
    def test_delayed_output_and_preference_are_checked(self):
        for mutate in [lambda d:d.pop('preference'),lambda d:d['preference'].update(selected_condition='wrong'),lambda d:d['frames'][-1].update(feedback_input_timestamp_ms=200000),lambda d:d['frames'][-1].update(actual_buffer_delay_ms=399),lambda d:d['frames'][-1].update(applied_jawOpen=0.8),lambda d:d['frames'][0].update(software_latency_ms=400),lambda d:d['ratings'][0].update(condition_position=3)]:
            d=fixture();mutate(d);self.assertTrue(validate_session(d))
    def test_dynamic_v4_records_remain_valid_without_becoming_v5(self):
        from session_data import DYNAMIC_AB_PROTOCOL
        old=DYNAMIC_AB_PROTOCOL;d=fixture();d.update(protocol_version=old['protocol_version'],schema_version=old['schema_version'],app_version=old['app_version'],parameters=copy.deepcopy(old['parameters']),task_plan=old['tasks'],question_items=old['questions'],condition_order=['A_prerecorded','B_realtime'])
        d['prerecorded_stimulus']['window_ms']=90000
        for field in ['conditions','frames','ratings']:d[field]=[row for row in d[field] if row['condition']!='C_delayed']
        for row in d['conditions']:row['active_ms']=90000
        for row in d['frames']+d['ratings']:row['condition_order']='AB';row['protocol_version']=old['protocol_version']
        self.assertEqual(validate_session(d),[])
        result=self.evaluate([d]);self.assertEqual(result['included_triplets'],[])
    def test_new_protocol_requires_six_scores_and_independent_matching_stimulus(self):
        for mutate in [lambda d:d.pop('prerecorded_stimulus'),lambda d:d['prerecorded_stimulus'].update(donor_id=d['participant_id']),lambda d:d['prerecorded_stimulus'].update(independence_confirmed=False),lambda d:d['prerecorded_stimulus'].update(duration_ms=None),lambda d:d['ratings'][0].pop('ownership'),lambda d:d['ratings'][1].update(expression=8),lambda d:d['frames'][12].update(applied_jawOpen=0.9),lambda d:d['question_items'][0].update(text='changed')]:
            data=fixture();mutate(data);self.assertTrue(validate_session(data))
    def test_previous_static_protocol_remains_readable_but_is_not_pooled(self):
        from session_data import STATIC_PROTOCOL
        d=fixture();d.update(protocol_version=STATIC_PROTOCOL['protocol_version'],app_version=STATIC_PROTOCOL['app_version'],schema_version=STATIC_PROTOCOL['schema_version'],parameters=copy.deepcopy(STATIC_PROTOCOL['parameters']),condition_order=['A','B'])
        for name in ['conditions','frames','ratings']:d[name]=[r for r in d[name] if r['condition']!='C_delayed']
        for row in d['conditions']+d['frames']+d['ratings']:row['condition']=row['condition'][0]
        for row in d['conditions']:row['active_ms']=90000
        for row in d['frames']:
            if row['condition']=='A':
                for key in COEFFICIENTS:row['applied_'+key]=0
        for row in d['ratings']:row['protocol_version']=d['protocol_version'];row['condition_order']='AB'
        self.assertEqual(validate_session(d),[])
        result=self.evaluate([d]);self.assertEqual(result['included_triplets'],[]);self.assertTrue(any(i['code']=='excluded_protocol' for i in result['validation_issues']))
    def evaluate(self,records=(),rows=(),manual_rows=()):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name);raw=root/'data/raw';raw.mkdir(parents=True)
        for index,data in enumerate(records):(raw/f'fixture-{index}.json').write_text(json.dumps(data))
        write_table(raw/'participants_v5.csv',rows)
        if manual_rows:
            table=root/'materials/engineering_acceptance.csv';table.parent.mkdir(parents=True)
            fields=['record_id','source_type','started_at','action','requested_repetitions','operator_observed_repetitions','visual_response','tracking_loss_notes','observed_render_fps','observed_result_hz','continuous_duration_s','operator','notes']
            with table.open('w',encoding='utf-8-sig',newline='') as handle:
                writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader();writer.writerows(manual_rows)
        return run(raw,root/'data/processed',root,render=False)

    def test_prerecorded_metadata_and_missing_face_constraints(self):
        data=fixture();self.assertEqual(validate_session(data),[]);data['frames'][0]['prerecorded_sha256']='b'*64;self.assertTrue(validate_session(data))
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
        result=self.evaluate();self.assertEqual(result['status'],'no_real_data');self.assertEqual(result['actual_counts']['complete_external_triplets'],0)
        self.assertIsNone(result['external_item_descriptions']['control']['A']['mean']);self.assertEqual(result['included_triplets'],[])

    def test_negative_pair_differences_are_retained(self):
        result=self.evaluate([fixture(a=6,b=2)]);self.assertEqual(result['actual_counts']['complete_external_triplets'],1)
        self.assertEqual(result['external_item_descriptions']['control']['B_minus_A']['mean'],-4)

    def test_synthetic_and_replay_are_excluded_even_if_in_raw(self):
        fake=fixture(source='synthetic_test');replay=fixture(source='recorded_tracking')
        result=self.evaluate([fake,replay],fake['ratings']);self.assertEqual(result['actual_counts']['unique_declared_live_anonymous_ids'],0);self.assertEqual(result['engineering_metrics'],[])
        self.assertIn('synthetic_test',result['actual_counts']['excluded_source_counts'])

    def test_duplicate_reexport_and_matching_csv_do_not_inflate_people(self):
        first=fixture();later=copy.deepcopy(first);later['exported_at']='2026-11-07T02:00:00+08:00'
        result=self.evaluate([first,later],first['ratings']);self.assertEqual(result['actual_counts']['complete_external_triplets'],1)
        self.assertTrue(any(issue['code']=='duplicate_export_merged' for issue in result['validation_issues']))

    def test_repeated_id_with_two_sessions_is_held_for_review(self):
        result=self.evaluate([fixture('TEST01'),fixture('TEST01')]);self.assertEqual(result['actual_counts']['complete_external_triplets'],0)
        self.assertTrue(any(issue['code']=='duplicate_participant_sessions' for issue in result['validation_issues']))

    def test_duplicate_csv_condition_missing_condition_and_out_of_range_are_flagged(self):
        data=fixture();rows=[data['ratings'][0],data['ratings'][0]];result=self.evaluate(rows=rows);self.assertEqual(result['included_triplets'],[])
        self.assertTrue(any(issue['code']=='duplicate_csv_condition' for issue in result['validation_issues']))
        result=self.evaluate(rows=[fixture('TEST02')['ratings'][0]]);self.assertTrue(any(issue['code']=='missing_condition' for issue in result['validation_issues']))
        data=fixture('TEST03');data['ratings'][0]['control']=8;result=self.evaluate(rows=data['ratings']);self.assertEqual(result['included_triplets'],[]);self.assertTrue(any(issue['code']=='invalid_rating' for issue in result['validation_issues']))

    def test_conflicting_csv_and_json_are_not_silently_resolved(self):
        data=fixture();rows=copy.deepcopy(data['ratings']);rows[0]['control']=1;result=self.evaluate([data],rows);self.assertEqual(result['included_triplets'],[])

    def test_internal_ratings_never_become_external_participants(self):
        result=self.evaluate([fixture(kind='internal')]);self.assertEqual(result['actual_counts']['complete_external_triplets'],0);self.assertEqual(result['actual_counts']['complete_internal_triplets'],1)

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
        result=self.evaluate(manual_rows=[row]);self.assertEqual(result['actual_counts']['manual_engineering_observation_rows'],1);self.assertEqual(result['actual_counts']['complete_external_triplets'],0);self.assertEqual(result['manual_engineering_observations'][0]['operator_observed_repetitions'],3)
        row['source_type']='synthetic_test';result=self.evaluate(manual_rows=[row]);self.assertEqual(result['actual_counts']['manual_engineering_observation_rows'],0)

    def test_short_csv_row_with_missing_source_is_flagged_without_crashing(self):
        data=fixture();row=data['ratings'][0].copy();row['source_type']=None
        result=self.evaluate(rows=[row]);self.assertEqual(result['included_triplets'],[]);self.assertTrue(any(issue['code']=='excluded_source' for issue in result['validation_issues']))

if __name__=='__main__':unittest.main(verbosity=2)
