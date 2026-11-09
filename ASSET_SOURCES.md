# 资产、依赖与实际映射

当前版本0.3.0。浏览器运行依赖固定为Three.js 0.160.1（MIT）、MediaPipe Tasks Vision 0.10.21（Apache-2.0）及官方Face Landmarker float16/1模型。精确URL、大小及SHA-256在evidence/dependency_lock.json。首次下载由scripts/fetch_assets.py校验，之后本地运行。

## 项目自制化身

app/models/ipp31078-cartoon-v2.glb由scripts/create_avatar.mjs生成；18个网格、17个实际非零形变、独立head_pivot节点，0个动画片段。没有外部真人头像、Face Cap网格或自动动作。当前资产摘要与映射见app/model_manifest.json；原版元数据见app/model_manifest-v1.json。

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
