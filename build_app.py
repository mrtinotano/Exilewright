"""Builds the app (needs PyInstaller and pywebview: python -m venv .venv-build, then
.venv-build/Scripts/pip install pyinstaller pywebview, then .venv-build/Scripts/python build_app.py):
  dist/Exilewright/Exilewright.exe     the program (its folder is what the installer installs)
  dist/Exilewright-portable.zip         the same folder with a "portable" file: it keeps its data next to the exe
  dist/Exilewright-setup.exe            the installer (installer.iss): it needs Inno Setup 6, and ends in an error without it
"build_app.py app" builds only the program and "build_app.py package" only the zip and installer from it."""
import glob
import os
import re
import shutil
import subprocess
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
stage = sys.argv[1] if len(sys.argv) > 1 else 'all'
if stage in ('all', 'app'):
    import PyInstaller.__main__
    data = ['index.html', 'LICENSE', 'mannequin.glb', 'moves.json', 'three', 'i18n', os.path.join('poe2_data', 'available'), *glob.glob('*.js')]
    PyInstaller.__main__.run(['serve.py', '--name', 'Exilewright', '--onedir', '--windowed', '--noconfirm', '--clean', '--icon', 'icon.ico',
                              *[f'--add-data={d}{os.pathsep}{d if os.path.isdir(d) else "."}' for d in data]])
    if stage == 'app':
        sys.exit()
app = os.path.join('dist', 'Exilewright')
open(os.path.join(app, 'portable'), 'w').close()
shutil.make_archive(os.path.join('dist', 'Exilewright-portable'), 'zip', 'dist', 'Exilewright')
os.remove(os.path.join(app, 'portable'))
iscc = next((p for p in map(os.path.expandvars, (r'%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe', r'%ProgramFiles%\Inno Setup 6\ISCC.exe',
                                                  r'%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe'))
             if os.path.isfile(p)), shutil.which('iscc'))
if iscc:
    version = re.search(r"^VERSION = '([\d.]+)'", open('serve.py', encoding='utf-8').read(), re.M)[1]
    subprocess.run([iscc, '/Q', f'/DAppVersion={version}', 'installer.iss'], check=True)
else:
    sys.exit('No Inno Setup 6: no installer (the portable zip is there)')   # an error: a release needs it
