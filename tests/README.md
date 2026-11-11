# 自动化检查

运行README中的Node与Python命令。delay.test.mjs覆盖时间戳缓冲、400ms、抖动调度、配置值、失跟/条件切换/时钟异常清理；tracker.test.mjs检查实际视频计数率与缺失状态。ui-flow.test.mjs执行实际main.js处理函数，使用内存DOM、相机、渲染替身，遍历全部六种顺序及200ms非默认配置，检查60秒任务、三次六题、自选偏好、暂停、时间异常、保存请求和4种导出。

所有夹具明确是synthetic_test或临时项目内的结构样例，不能作为真实素材或参与者数据。Node页面处理测试可直接运行node tests/ui-flow.test.mjs 输出路径，把实际生成的synthetic JSON交给Python保存校验。Python HTTP测试只写临时根目录，验证追加保存、重复导出不增行、旧表字节保护、旧协议兼容与新协议不混合。

这些不证明真实相机、GPU画面、自然性、物理端到端延迟或人群结果。真人验收按materials/operator_guide.md执行，缺FFmpeg时媒体编码检查跳过，不安装依赖或修改环境变量。
