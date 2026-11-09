# IPP31078 数据字典与来源规则

协议IPP31078-AB90-v3，软件0.3.0，JSON结构3.0.0。旧版60秒/5题导出与本版不混合。

## 来源与记录用途

| 字段 | 值 | 含义与分析规则 |
| --- | --- | --- |
| source_type | live_camera | 声明来自当前摄像头；实际真实性仍需对照操作者记录和演示核验 |
| source_type | recorded_tracking | 已记录参数的回放；界面持续标识，正式A/B体验禁用，不计新参与者或真实相机性能 |
| source_type | synthetic_test | 明确的软件测试输入；保存到evidence/testing/v2/，始终排除出研究及真实摄像头工程统计 |
| record_kind | internal | 项目组本人/内部试用，与外部样本分开报告 |
| record_kind | exploratory | 经同意的小规模探索性体验，实际收回完整配对后才计数 |
| record_kind | engineering | 展示模式的参数记录，不包含问卷，不计作外部参与者 |

匿名编号不是身份证明；同一人不能用多个编号增加人数。会话UUID不是参与者人数。同一会话的相同重复导出不增加人数，同编号多个会话需人工核对后选定，脚本不会挑选更有利的结果。

## participants.csv长表

初始化仅一行表头，0条数据。一位参与者在A/B完成后各有一行。真实评分由实际体验者完成；完整实时会话保存后自动追加，同会话重复保存不会重复追加。

| 列 | 类型和说明 |
| --- | --- |
| participant_id | 2–24位匿名文本编号，如分配表中的P01；不填姓名或学号 |
| session_id | 完整JSON中的UUID；手工问卷也需使用一致、可追溯的会话编号 |
| record_kind | internal或exploratory，不能缺失或把内部试用改成外部 |
| source_type | live_camera；回放与软件测试不纳入真人评分 |
| condition_order | AB或BA，测试前固定并在两行一致 |
| condition | A或B；A静态中性，B本人同步 |
| submitted_at | 真实作答时间，ISO8601并含时区，例如实际操作时的北京时间+08:00或UTC的Z；示例格式不是历史记录 |
| control | 面部控制感，1–7整数 |
| congruence | 动作一致性，1–7整数 |
| identification | 化身认同，1–7整数 |
| naturalness | 自然程度，1–7整数 |
| comment | 一句真实开放反馈，可留空，不填身份信息 |

保存UTF-8 CSV。空值不是0分。评分8、0、负数、分数或缺失均会被标记；数值4.0可规范化为整数4，原文件不改写。重复同编号/会话/条件、缺失一条件、JSON与CSV冲突会暂时排除配对并列原因。

## 完整JSON与帧指标

每次study_session包含项目/软件/协议版本、匿名编号、来源、条件顺序、固定参数快照、中性校准、模型SHA-256与真实形变字典、相机分辨率/帧率设置（不记录deviceId/groupId）、任务、条件状态、事件、逐帧指标与四题自评。

- captured_at：实际记录时间（含时区）；monotonic_ms：浏览器单调时间，用于时间间隔与更新率。
- active_ms：仅在前台、可用面部且未暂停时累积的有效任务时间；wall_elapsed_ms为条件的墙钟跨度，可能更长。
- detected：1表示该次结果有面部及完整系数，0表示丢失；丢失原始系数为null，应用系数回中性，不补造有效帧。
- sample_kind：result为一次实际检测结果，tracking_timeout为结果过期；回放为replay_frame，不当作新推理。
- raw_*：检测器输出的5个系数；corrected_*：减中性基线并处理死区后系数；applied_*：平滑后实际写入模型的系数。A的应用值始终0。
- render_fps：实际渲染调用计数的滑窗速率；tracking_update_hz：实际结果的滑窗更新率；avatar_update_hz：实际形变应用调用的滑窗速率。窗口不足时为null。
- inference_ms：单次detectForVideo执行耗时，不含采集、显示与传输，不能写成端到端延迟。回放无新推理时为null。
- calibration.baseline：至少3秒且至少30个有效样本的逐系数中位数。duration_ms是要求的3000ms，observed_duration_ms为实际采样跨度；低更新率时会延长收样，最多15秒。
- protocol_deviations：窗口变化等事件；界面会要求恢复窗口后继续，分析时仍需人工审阅。

data/raw/tracking/存放真实工程参数片段；live_sessions/存放真实来源声明下的体验JSON。原始文件不覆盖。media/raw/01_live.mp4及.metadata.json记录实际录像、校验和、来源声明、时长检查与转换方式；不能用空占位文件代替。

## 分析输出

results.json包含实际编号数、完整配对数、内部/外部分组、AB/BA分配、逐题A/B描述与B−A差值、来源SHA-256、问题清单及局限。paired_scores.csv逐人逐题保存差值；engineering_metrics.csv包含基于实际时间戳的更新率、日志fps、丢失、系数范围和阈值周期估计。四题不相加，单人不能代表人群。

materials/engineering_acceptance.csv为人工验收空表。action填写jaw、blink、smile、combined或stability；重复动作需填写实际要求次数、肉眼观察次数与视觉响应，连续稳定性需填写真实持续秒数、实际读到的fps和结果Hz。时间含时区，同一record_id与action不重复，未执行就留空。分析脚本读取该表，排除合成/回放来源，验证次数与数值，输出engineering_observations.csv及results.json中的manual_engineering_observations；人工读数不冒充帧日志中位数，也不当作参与者或问卷。

点图每个点对应一个真实匿名编号，A为空心、B为实心，连线仅对应同一人；没有真实配对时不画虚构点。工程图同样在没有真实记录时显示无数据。源是合成输入的连续软件测试单独保存在evidence/testing/v2/，不填进真实工程图。

## v3与工程评估补充

当前协议为IPP31078-AB90-v3，旧v2记录保留原版本和模型摘要；后端分别校验，问卷分析不混用协议。17个系数及模型映射见app/model_manifest.json。pose_valid标识矩阵是否有效；raw_pose_*为原始旋转，corrected_pose_*为中性基准相对旋转，applied_pose_*为限幅和平滑后旋转，单位弧度。A、B均有相同头部驱动。

data/raw/evaluations保存engineering_evaluation记录，内含完整tracking、独立trial_id、实际开始/完成时间、人工观察成功次数（可为null）、前台可见计时、实际渲染计数和浏览器视频计数。该记录不写参与者表。评估脚本按每份记录、每个协议分别分析。

frame_to_render_submit_ms与video_present_to_render_submit_ms只在对应帧时钟可用时填写，是浏览器管线时间，不是物理端到端延迟。外部同步录像的帧标注使用video_metric_annotations.csv；未核对实际拍摄帧率或只有浏览器合成视频时不能纳入物理延迟指标。
