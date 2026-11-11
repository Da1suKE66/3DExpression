# IPP31078 数据字典 v5

本字典与[统一实验基准](实验设置与报告引用基准_v5.md)、[机器可读快照](experiment_baseline_v5.json)配合使用；后者不是运行配置。

软件0.5.0，协议IPP31078-ABC60-v5，schema5.0.0。JSON原始记录与统计输出分开；旧v2/v3/v3.1/v4原件不改写。

| 字段 | 定义 |
| --- | --- |
| participant_id / session_id | 匿名编号与UUID；不要求真实身份 |
| condition | A_prerecorded / B_realtime / C_delayed；旧A或A_static只按旧协议解释，不能并入新A |
| condition_order | 会话JSON存完整条件名数组，CSV/评分存ABC等六种排列 |
| condition_position / block_index | 同一实际位置1/2/3，两字段一致 |
| task_id / task | adapt、basic、free、observe；非正式演示为demonstration |
| timestamp / captured_at | 该条写入时的带时区ISO时间，不冒充相机曝光时刻 |
| monotonic_ms / input_timestamp_ms | 模型结果完成时的单调时间；不是相机曝光时间，丢失/超时无有效输入时后者为空 |
| input_available_at_ms | 本次映射、重定向与滤波完成后的可用时刻，即可入队时刻 |
| feedback_input_timestamp_ms | 实际应用的表情所对应输入的结果时间；B为当前，C为更早的本条件输入，A为空 |
| feedback_buffer_enqueue_ms | 该表情处理结果可用/入队时刻；C缓冲起点 |
| feedback_applied_at_ms | 对应参数用于化身apply调用的时刻，不是物理显示时刻 |
| added_delay_ms | C的设定附加延迟，默认400；A/B为0；会话parameters.added_delay_ms保存C配置 |
| actual_buffer_delay_ms | C实际应用时刻减入队时刻；B就绪时为0；A、缓冲不足、暂停/失跟为空 |
| feedback_state | ready / warming_up / prerecorded / inactive，区分就绪、预热、预录和无输出 |
| software_latency_ms | 对应输入处理开始到输出渲染提交的可观测CPU链路，包含C缓冲；A、预热、无对应输入或未渲染为空。不是物理端到端延迟 |
| normal_processing_ms | 对应输入从模型处理开始到映射滤波结果可用，不含人为队列 |
| render_submitted_at_ms / output_rendered | render调用提交时刻与该条输出是否仍被提交；条件结束前被中性替换的条目不填对应输出链路耗时 |
| frame_to_render_submit_ms / video_present_to_render_submit_ms | 浏览器提供并匹配的相机/呈现时间到对应输出提交；无元数据或A无对应关系时空，不冒充视觉延迟 |
| camera_input_fps | 浏览器视频回调实际presentedFrames计数率，非请求frameRate，非直接传感器曝光帧率；不可观测时null |
| tracking_fps / tracking_update_hz | 模型结果的观测更新率，检测失败结果也算实际推理；超时诊断不算新模型结果 |
| render_fps / inference_ms | 实际render调用率与本次模型计算耗时；分别保存 |
| tracking_valid / detected | 当前采样检测状态，布尔/0或1；成功率按result样本中检测成功比例计算 |
| raw_* / corrected_* / target_* / live_filtered_* | 当前人的17通道原始、校正、重定向、滤波系数；A也保留实时输入；丢失为null |
| applied_* | 实际面部输出；A取录制后系数，B取当前滤波结果，C取队列到期结果；预热/无效时为0 |
| raw_pose_* / applied_pose_* | 头姿始终是当前人的实时处理结果，不随C面部队列延迟 |
| prerecorded_stimulus / prerecorded_sha256 / prerecorded_position_ms | 独立真实录制的来源、匿名录制者、原协议、模型与文件SHA、时长、随机窗口及每帧原时间轴位置；A不计算参与者动作响应延迟 |
| active_ms / wall_elapsed_ms / events | 有效时间与墙钟及暂停、丢失、恢复、任务、问卷、异常事件 |
| ratings / 六个分值列 | 每条件六题1–7分，自评时间和条件位置；JSON内ratings即questionnaire_scores的逐条件记录，CSV展开六列 |
| open_feedback / comment | 同一可空反馈文字，不收身份信息 |
| preference / overall_preference | 会话最终偏好及提交时间；问卷三行附同一偏好值作为元数据，不当作三次独立偏好 |

新表data/raw/participants_v5.csv，六题与整体偏好可同时从完整JSON和CSV导出，另有专用偏好CSV。原始JSON按UUID及新导出后缀追加；旧participants.csv、participants_v4.csv及旧会话不覆盖。分析只合并同协议、同C设定400ms的完整三条件记录；不同角色/素材亦应人工核对后分层。输出data/processed/abc_v5及materials/results_note_v5.md。

三条件完整会话保存接口上限128MB，仍校验最多30000条帧；参数录制接口和素材读取上限32MB。正常60秒三条件完整逐帧数据可能接近原32MB限制；不通过删除历史或丢弃采样缩小文件。过长暂停仍应停止并保留不完整会话，保存失败时先下载完整JSON备份。

中性参数抖动需要明确的neutral工程任务；适应和整体观察不自动视为中性。原工程评估保留中性10秒、逐动作人工观察与外部视频标注，不从阈值周期推断真实动作准确率。无输入数据或无人工观察时保持null，不能填0。
