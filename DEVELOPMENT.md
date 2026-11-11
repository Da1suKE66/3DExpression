# IPP31078 当前开发交接

软件0.5.0；协议IPP31078-ABC60-v5；schema 5.0.0；工程评估协议IPP31078-EVAL-v1。更新日期：2026年11月10日。

先读[实验设置基准](materials/实验设置与报告引用基准_v5.md)、[操作说明](materials/operator_guide.md)、[数据字典](materials/data_dictionary.md)。A/B基础版本提交为a6d0721；本版加入ABC60-v5及文档同步。交接时以实际git status/log确认提交与推送状态，不假定可整目录覆盖。

## 修改应到达的位置

| 改动 | 需要同时检查 |
| --- | --- |
| 条件/顺序/任务/题目 | app/core.js → app/main.js及index.html → app/protocol.json → scripts/session_data.py/analyze.py → 新版CSV表头 → 文档基准及相关测试 |
| C队列/延迟 | app/delay.js与main.js；不改B滤波或头动，不阻塞推理；检查重置、预热、时间异常及源输入关联 |
| A素材 | app/prerecorded.js、replay.js；真实来源、独立性、60秒连续窗口、同角色同配置；不使用合成夹具替代真实素材 |
| 保存/导出 | main.js、core.js列定义、scripts/serve.py/session_data.py、templates/participants_v5.csv、analyze.py；原始记录追加，版本隔离 |
| 版本升级 | core.js、package.json、HTML资源版本、协议快照与旧版存档；旧JSON按旧协议解释，不原地补题或改条件 |

校准仍3秒且至少30个有效样本，眨眼35ms、其他表情80ms、头姿100ms；参数是配置，不是性能实测值。C默认400ms位于表情映射/平滑之后，实际等待另记；所有条件头动实时。A的记录已平滑，回放不二次平滑。每条件有效60秒，失跟等暂停不计有效时间。

## 最小验证与手工验收

在工程目录使用现有本机运行时，不因文档维护安装依赖或改环境变量：

```sh
node --test tests/core.test.mjs tests/expressions.test.mjs tests/prerecorded.test.mjs tests/delay.test.mjs tests/tracker.test.mjs tests/ui-flow.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
```

需要模型/依赖/协议检查时运行node scripts/build.mjs；它会刷新v5检查文件，不会默认打包，不要为文档修改重新生成GLB。构建生成protocol.json，勿只手工改JSON而漏改core.js。测试说明见tests/README.md；HTTP测试使用工程内临时目录及synthetic_test隔离记录，不写真实数据目录。可选FFmpeg缺失应记跳过。

本次未改运行逻辑；打包清单补充DEVELOPMENT.md及两份实验基准，避免复制工程后缺少新说明。只做打包脚本语法与清单检查，未实际生成新的迁移包，未重复全套上一轮已通过的测试；同步检查验证版本、任务、六题、表头、链接及保护文件哈希。真实操作仍按operator_guide.md：独立录制、真实相机校准、六序试跑、失跟恢复、问卷/偏好归属、保存和四类下载。尚待真实验收：独立真人预录素材及其自然性、A/B活动量可比性、真实摄像头持续驱动、C在实际设备上的缓冲分布、参与者评分和外部视觉延迟。模拟夹具与软件测试不是参与者实验数据。

## 数据和报告保护

历史A_static、旧动态A/B与新ABC不能合并；非默认C延迟不能混作400ms。保留原始JSON及素材SHA；分析写data/processed/abc_v5。实时/回放/合成来源区分，模拟文件不注册为真人成果。完整会话接口上限128MB、最多30000帧，素材读取/录制接口32MB；保存失败先下载完整备份。

研究局限：A与B除同步性外还可能存在录制者及表情内容差异；B与C的附加延迟变量控制更明确。本实验不是完整的双因素析因设计，不能声称分别估计所有因素的主效应与交互效应。桌面面部体验不能推广为完整VR、全身所有权或自我定位。

论文正文暂保留。后续修订入口为工作区materials/当前材料使用说明_v5.md。不要把新开发或自动化编写倒写成成员过去亲历的贡献。本地工作区由项目操作者指定；不处理无关目录和环境设置。
