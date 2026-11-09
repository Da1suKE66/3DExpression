# 笔记本跨平台辅助资产

此目录不包含 Python 解释器、个人账户或服务器凭据。使用笔记本自己的 Python 3.12+。

`tzdata-2026.6-py2.py3-none-any.whl` 是 CPython 团队发布的纯 Python／数据通用包。迁移入口校验 SHA-256 后直接加载，避免 Windows 缺少 IANA 时区数据而不能保存北京时间记录；不需要 pip 安装。锁定2026.6，与分析依赖清单一致，本项目只使用 Asia/Shanghai。来源、大小和摘要见 source.json。

官方来源：[PyPI固定版本](https://pypi.org/project/tzdata/2026.6/)，[Python时区文档](https://docs.python.org/3/library/zoneinfo.html)。包许可见 tzdata-LICENSE.txt，Apache 2.0 全文见 tzdata-LICENSE_APACHE.txt；原始许可证也保留在 wheel 内。没有修改第三方包内容。

Mac服务器上的 `.analysis_deps` 含本机原生二进制，不随迁移包复制。需要绘图或MP4转换时，在目标笔记本运行 `python launch.py install`，按照固定依赖清单安装到本项目目录；首次需要网络。原型浏览器运行资产已在app/，普通体验不需要这一步。
