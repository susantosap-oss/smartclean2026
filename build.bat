@echo off
setlocal enabledelayedexpansion
title SmartClean APK Builder
color 0A

echo.
echo  ====================================================
echo    SmartClean APK Builder v1.0
echo    Builds smartclean.apk using Capacitor + Android
echo  ====================================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo Download from: https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v

:: Check Java
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Java JDK not found!
    echo Download from: https://adoptium.net
    pause & exit /b 1
)
echo [OK] Java found

echo.
echo [1/5] Installing npm dependencies...
call npm install
if %errorlevel% neq 0 ( echo [ERROR] npm install failed! & pause & exit /b 1 )
echo [OK] Dependencies installed

echo.
echo [2/5] Copying web assets...
if not exist "android\app\src\main\assets\public" mkdir "android\app\src\main\assets\public"
xcopy /E /Y /Q "src\*" "android\app\src\main\assets\public\"
echo [OK] Web assets copied

echo.
echo [3/5] Syncing Capacitor...
call npx cap sync android
if %errorlevel% neq 0 ( echo [ERROR] Capacitor sync failed! & pause & exit /b 1 )
echo [OK] Capacitor synced

echo.
echo [4/5] Generating debug keystore...
if not exist "android\debug.keystore" (
    keytool -genkey -v -keystore android\debug.keystore -alias androiddebugkey ^
        -keyalg RSA -keysize 2048 -validity 10000 ^
        -dname "CN=SmartClean, OU=Dev, O=SmartClean, L=Jakarta, ST=Jakarta, C=ID" ^
        -storepass android -keypass android >nul 2>&1
    echo [OK] Debug keystore created
) else (
    echo [OK] Debug keystore exists
)

echo.
echo [5/5] Building debug APK...
cd android
call gradlew.bat assembleDebug --stacktrace
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed! Check errors above.
    cd ..
    pause & exit /b 1
)
cd ..

echo.
echo ====================================================
echo   BUILD SUCCESSFUL!
echo ====================================================
echo.
echo  APK Location:
echo    android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo  Renaming to smartclean.apk...
copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "smartclean.apk" >nul
echo  Output: smartclean.apk
echo.
echo  Install on Android:
echo    1. Copy smartclean.apk to your phone
echo    2. Enable "Install from Unknown Sources"
echo    3. Tap the APK to install
echo.
pause
