; Inno Setup 6 script for the installer (build_app.py runs it): installs dist\PoE2 Planner for the current user,
; no admin rights needed. The app keeps its data in %LOCALAPPDATA%\PoE2 Planner, which uninstalling leaves alone.
[Setup]
AppName=PoE2 Planner
AppVersion=1.0
AppPublisher=OxtailGames
DefaultDirName={autopf}\PoE2 Planner
DefaultGroupName=PoE2 Planner
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=PoE2-Planner-setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\PoE2 Planner.exe
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "dist\PoE2 Planner\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\PoE2 Planner"; Filename: "{app}\PoE2 Planner.exe"
Name: "{group}\{cm:UninstallProgram,PoE2 Planner}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\PoE2 Planner"; Filename: "{app}\PoE2 Planner.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\PoE2 Planner.exe"; Description: "{cm:LaunchProgram,PoE2 Planner}"; Flags: nowait postinstall skipifsilent
