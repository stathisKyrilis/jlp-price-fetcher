@echo off
echo Running git status in this directory...
git status
echo.
SET /P commit_message="Enter commit message: "
git add .
git commit -m "%commit_message%"
git push
echo.
echo Changes have been committed and pushed.
pause 