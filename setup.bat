@echo off
title SmartClean - First Time Setup
color 0B

echo.
echo  ============================================
echo    SmartClean - First Time Setup
echo  ============================================
echo.

:: Check prerequisites
echo Checking prerequisites...
echo.

:: Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [MISSING] Node.js
    echo           Download: https://nodejs.org  (LTS version)
    set MISSING=1
) else (
    for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v
)

:: Java
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [MISSING] Java JDK 17+
    echo           Download: https://adoptium.net
    set MISSING=1
) else (
    echo [OK] Java JDK found
)

:: Android SDK / ANDROID_HOME
if "%ANDROID_HOME%"=="" (
    if "%ANDROID_SDK_ROOT%"=="" (
        echo [MISSING] Android SDK  (ANDROID_HOME not set)
        echo           Download Android Studio: https://developer.android.com/studio
        echo           Or set ANDROID_HOME to your SDK folder
        set MISSING=1
    ) else (
        echo [OK] Android SDK at %ANDROID_SDK_ROOT%
    )
) else (
    echo [OK] Android SDK at %ANDROID_HOME%
)

if defined MISSING (
    echo.
    echo  Please install missing prerequisites above, then re-run setup.bat
    echo.
    pause & exit /b 1
)

echo.
echo [Step 1] Installing npm dependencies...
call npm install
if %errorlevel% neq 0 ( echo [ERROR] npm install failed & pause & exit /b 1 )

echo.
echo [Step 2] Downloading Gradle wrapper jar...
if not exist "android\gradle\wrapper\gradle-wrapper.jar" (
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nicokant/gradle-wrapper-jar/main/gradle-wrapper.jar' -OutFile 'android\gradle\wrapper\gradle-wrapper.jar' }"
    if not exist "android\gradle\wrapper\gradle-wrapper.jar" (
        echo.
        echo [INFO] Could not download gradle-wrapper.jar automatically.
        echo        Run these commands manually:
        echo        cd android
        echo        gradle wrapper --gradle-version 8.4
        echo        cd ..
        echo.
        echo        OR open the project in Android Studio which will handle this.
    ) else (
        echo [OK] gradle-wrapper.jar downloaded
    )
) else (
    echo [OK] gradle-wrapper.jar exists
)

echo.
echo [Step 3] Syncing Capacitor to Android project...
call npx cap sync android
if %errorlevel% neq 0 ( echo [ERROR] cap sync failed & pause & exit /b 1 )

echo.
echo [Step 4] Generating debug keystore...
if not exist "android\debug.keystore" (
    keytool -genkey -v -keystore android\debug.keystore -alias androiddebugkey ^
        -keyalg RSA -keysize 2048 -validity 10000 ^
        -dname "CN=SmartClean, OU=Dev, O=SmartClean, L=Jakarta, ST=Jakarta, C=ID" ^
        -storepass android -keypass android
    echo [OK] Keystore created
) else (
    echo [OK] Keystore exists
)

echo.
echo  ============================================
echo    Setup complete! Now run: build.bat
echo  ============================================
echo.
pause
