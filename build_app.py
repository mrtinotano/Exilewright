"""Builds the app (needs PyInstaller and pywebview: python -m venv .venv-build, then
.venv-build/Scripts/pip install pyinstaller pywebview, then .venv-build/Scripts/python build_app.py):
  dist/PoE2 Planner/PoE2 Planner.exe     the program (its folder is what the installer installs)
  dist/PoE2-Planner-portable.zip         the same folder with a "portable" file: it keeps its data next to the exe
  dist/PoE2-Planner-setup.exe            the installer, when Inno Setup 6 is installed (installer.iss)"""
import glob
import os
import shutil
import subprocess
import PyInstaller.__main__

os.chdir(os.path.dirname(os.path.abspath(__file__)))
data = ['index.html', 'i18n', os.path.join('poe2_data', 'available'), *glob.glob('*.js')]
PyInstaller.__main__.run(['serve.py', '--name', 'PoE2 Planner', '--onedir', '--windowed', '--noconfirm', '--clean', '--icon', 'icon.ico',
                          *[f'--add-data={d}{os.pathsep}{d if os.path.isdir(d) else "."}' for d in data]])
app = os.path.join('dist', 'PoE2 Planner')
open(os.path.join(app, 'portable'), 'w').close()
shutil.make_archive(os.path.join('dist', 'PoE2-Planner-portable'), 'zip', 'dist', 'PoE2 Planner')
os.remove(os.path.join(app, 'portable'))
iscc = next((p for p in (os.path.join(os.environ.get(v, ''), 'Inno Setup 6', 'ISCC.exe') for v in ('ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA'))
             if os.path.isfile(p)), shutil.which('iscc'))
if iscc:
    subprocess.run([iscc, '/Q', 'installer.iss'], check=True)
else:
    print('No Inno Setup 6: no installer (the portable zip is there)')
