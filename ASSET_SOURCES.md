# 资产、依赖与实际映射

当前版本0.3.1。浏览器运行依赖固定为Three.js 0.160.1（MIT）、MediaPipe Tasks Vision 0.10.21（Apache-2.0）及官方Face Landmarker float16/1模型。精确URL、大小及SHA-256在evidence/dependency_lock.json。首次下载由scripts/fetch_assets.py校验，之后本地运行。

## 项目自制化身

三种化身均由scripts/create_avatar.mjs使用球体、曲线及参数化眼皮生成，无下载的角色网格或贴图：

- app/models/doraemon-v1.glb：哆啦A梦自制卡通版，39个网格。
- app/models/pikachu-v1.glb：皮卡丘自制卡通版，31个网格。
- app/models/original-v1.glb：原版人头，24个网格；原有18个部件的中性顶点位置逐字节保留，新增6个上下眼皮及闭眼线网格，见evidence/testing/v3_1/original_geometry_restore.json。

三者都有17个实际非零形变、独立head_pivot及上下眼皮/闭眼线，无动画片段。角色名称及形象属于相应权利人，这些是项目绘制的非官方同人练习模型。角色清单、逐文件摘要及实际映射见app/avatar_catalog.json；默认模型副本为app/model_manifest.json；v2、v3.0元数据分别保存在model_manifest-v1.json、model_manifest-v2.json，供旧记录校验。

眼球不因眨眼缩放；上下眼皮合拢，闭眼时遮住眼球与高光。中性校准后的眨眼信号在0.08至0.55区间平滑映射到0至1，完整闭眼优先于睁大眼睛。眨眼通道35ms平滑，其他表情80ms。切换角色清除旧校准；录像、未保存记录和A/B体验期间锁定角色。

形变名称与MediaPipe类别逐一对应：jawOpen、eyeBlinkLeft、eyeBlinkRight、mouthSmileLeft、mouthSmileRight、mouthFrownLeft、mouthFrownRight、browDownLeft、browDownRight、browInnerUp、browOuterUpLeft、browOuterUpRight、eyeWideLeft、eyeWideRight、mouthPucker、mouthPressLeft、mouthPressRight。“伤心”“惊讶”等是动作组合标签，不是对真实情绪的识别结论。

头部变换使用官方facialTransformationMatrixes输出，去除缩放、按YXZ分解、中性校准后取镜像相对旋转。原始及应用旋转均记录，限幅和平滑参数在协议中固定。A/B使用同一头部驱动。

项目自制代码、几何及模型的公开上传由项目所有者请求；没有另行指定开源许可，不能把依赖许可自动套用为所有项目资产的许可。

## 第三方来源

- [Three.js](https://github.com/mrdoob/three.js/tree/r160)，MIT；Three.js及GLTFLoader许可随运行资产下载。
- [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.21)，Apache-2.0；版本与字节摘要固定。
- [官方Face Landmarker模型](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)，模型卡及使用范围参考[官方说明](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker?tab=Web)。未把其表情系数作为身份识别或情绪诊断。
- [官方Three.js摄像头形变例程](https://github.com/mrdoob/three.js/blob/r160/examples/webgl_morphtargets_webcam.html)仅作为API参考；不分发其中Face Cap网格。
- portable/中的tzdata wheel及许可用于离线时区支持，来源和摘要在portable/source.json。

真实摄像头、镜像方向、不同人的自然动作幅度与新增功能仍需人工验收。软件截图只证明所注明的测试输入和渲染状态，不是参与者或实验结果。
