"""Builds the portable app: dist/PoE2 Planner/PoE2 Planner.exe (copy the whole folder anywhere; the builds are kept in
its "profile" folder). Needs PyInstaller: python -m venv .venv-build && .venv-build/Scripts/pip install pyinstaller,
then: .venv-build/Scripts/python build_app.py"""
import glob
import os
import PyInstaller.__main__

os.chdir(os.path.dirname(os.path.abspath(__file__)))
data = ['index.html', 'i18n', os.path.join('poe2_data', 'available'), *glob.glob('*.js')]
PyInstaller.__main__.run(['serve.py', '--name', 'PoE2 Planner', '--onedir', '--windowed', '--noconfirm', '--clean',
                          *[f'--add-data={d}{os.pathsep}{d if os.path.isdir(d) else "."}' for d in data]])
