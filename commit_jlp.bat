@echo off
echo ========================================
echo  JLP Price Fetcher Commit Script
echo ========================================
echo.

REM --- Check for unstaged changes ---
echo Checking Git status...
git status --short
echo.

REM --- Stage all changes ---
echo Staging all changes (git add .)...
git add .
echo Done staging.
echo.

REM --- Prompt for commit message ---
set /p commitMessage="Enter commit message: "

REM --- Check if message is empty ---
if "%commitMessage%"=="" (
    echo ERROR: Commit message cannot be empty. Aborting.
    goto End
)

REM --- Commit changes ---
echo Committing changes...
git commit -m "%commitMessage%"
echo.

echo ========================================
echo  Commit complete.
echo  Remember to 'git push origin main' manually if needed.
echo ========================================
echo.

:End
pause