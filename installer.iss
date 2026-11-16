; Inno Setup 6 script for the installer (build_app.py runs it): installs dist\Exilewright for the current user,
; no admin rights needed. The app keeps its data in %LOCALAPPDATA%\Exilewright, which uninstalling leaves alone.
[Setup]
AppName=Exilewright
AppVersion=1.0
AppPublisher=OxtailGames
DefaultDirName={autopf}\Exilewright
DefaultGroupName=Exilewright
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=Exilewright-setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Exilewright.exe
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "dist\Exilewright\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Exilewright"; Filename: "{app}\Exilewright.exe"
Name: "{group}\{cm:UninstallProgram,Exilewright}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Exilewright"; Filename: "{app}\Exilewright.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Exilewright.exe"; Description: "{cm:LaunchProgram,Exilewright}"; Flags: nowait postinstall skipifsilent
