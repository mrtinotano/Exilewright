; Inno Setup 6 script for the installer (build_app.py runs it): installs dist\Exilewright for the current user,
; no admin rights needed. The app keeps its data in %LOCALAPPDATA%\Exilewright, which uninstalling leaves alone.
[Setup]
AppName=Exilewright
AppVersion=1.1
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

; the ten languages of Path of Exile 2; the setup picks the one of Windows (Traditional Chinese is not shipped with
; Inno Setup 6: installer\ChineseTraditional.isl is the one from its repository, jrsoftware/issrc)
[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "ko"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "th"; MessagesFile: "compiler:Languages\Thai.isl"
Name: "zh"; MessagesFile: "installer\ChineseTraditional.isl"

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
