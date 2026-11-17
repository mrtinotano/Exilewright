"""Builds the app (needs PyInstaller and pywebview: python -m venv .venv-build, then
.venv-build/Scripts/pip install pyinstaller pywebview, then .venv-build/Scripts/python build_app.py):
  dist/Exilewright/Exilewright.exe     the program (its folder is what the installer installs)
  dist/Exilewright-portable.zip         the same folder with a "portable" file: it keeps its data next to the exe
  dist/Exilewright-setup.exe            the installer, when Inno Setup 6 is installed (installer.iss)"""
import glob
import os
import re
import shutil
import subprocess
import PyInstaller.__main__

os.chdir(os.path.dirname(os.path.abspath(__file__)))
data = ['index.html', 'i18n', os.path.join('poe2_data', 'available'), *glob.glob('*.js')]
PyInstaller.__main__.run(['serve.py', '--name', 'Exilewright', '--onedir', '--windowed', '--noconfirm', '--clean', '--icon', 'icon.ico',
                          *[f'--add-data={d}{os.pathsep}{d if os.path.isdir(d) else "."}' for d in data]])
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
    print('No Inno Setup 6: no installer (the portable zip is there)')
