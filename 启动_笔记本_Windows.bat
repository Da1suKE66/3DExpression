@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "launch.py" goto missing
if not exist ".venv\Scripts\python.exe" goto try312
".venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" >nul 2>&1
if not errorlevel 1 goto venv
:try312
py -3.12 -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" >nul 2>&1
if not errorlevel 1 goto py312
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" >nul 2>&1
if not errorlevel 1 goto py3
python -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" >nul 2>&1
if not errorlevel 1 goto python
echo 未找到 Python 3.12 或以上。请从 https://www.python.org/downloads/ 安装。
echo 安装时启用 Python Launcher 或 Add Python to PATH，然后重新启动此文件。
goto failed
:venv
".venv\Scripts\python.exe" -u launch.py %*
goto finished
:py312
py -3.12 -u launch.py %*
goto finished
:py3
py -3 -u launch.py %*
goto finished
:python
python -u launch.py %*
goto finished
:missing
echo 未找到 launch.py。请完整解压迁移包后再运行。
:failed
pause
exit /b 1
:finished
set "TASK_EXIT=%ERRORLEVEL%"
echo.
echo 本次运行已结束。按任意键关闭窗口。
pause >nul
exit /b %TASK_EXIT%
