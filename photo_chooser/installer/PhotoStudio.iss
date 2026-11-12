; Photo Studio – installer (Inno Setup 6). Built by release.py:  ISCC /DAppVersion=X.Y.Z installer\PhotoStudio.iss
;
; Installs for the current user (no administrator rights needed) in
;   %LOCALAPPDATA%\Programs\Photo Studio
; like VS Code, Discord, Spotify… : it appears in Start menu and in Settings › Apps › Installed apps,
; and the app can update itself without asking for admin rights.
; The user's projects are NOT here: they live in Documents\Photo Studio and are never removed.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{9E1A2035-EB64-4A56-88BF-85165C97DCAC}
AppName=Photo Studio
AppVersion={#AppVersion}
AppVerName=Photo Studio {#AppVersion}
AppPublisher=Ewen Morvan
DefaultDirName={localappdata}\Programs\Photo Studio
DefaultGroupName=Photo Studio
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputBaseFilename=PhotoStudio-Setup-{#AppVersion}
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\Photo Studio.exe
UninstallDisplayName=Photo Studio
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer une icône sur le Bureau"; GroupDescription: "Raccourcis :"

[Files]
Source: "..\dist\Photo Studio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; the previous version's files (libraries may have changed)
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\Photo Studio"; Filename: "{app}\Photo Studio.exe"
Name: "{autodesktop}\Photo Studio"; Filename: "{app}\Photo Studio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Photo Studio.exe"; Description: "Lancer Photo Studio"; Flags: nowait postinstall skipifsilent
; installed silently by an update from inside the app: start it again
Filename: "{app}\Photo Studio.exe"; Flags: nowait; Check: WizardSilent

[UninstallDelete]
; downloaded updates and caches – NOT the projects in Documents\Photo Studio
Type: filesandordirs; Name: "{localappdata}\PhotoStudio\versions"
Type: filesandordirs; Name: "{localappdata}\PhotoStudio\cache"
