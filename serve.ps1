#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# Define the root path
$RootPath = $PSScriptRoot
Set-Location -Path $RootPath

# Function to check if Python is installed
function Check-Python {
    try {
        $pythonVersion = python --version 2>&1
        Write-Host "Python found: $pythonVersion" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "Python is not installed or not in the PATH." -ForegroundColor Red
        Write-Host "Please install Python 3.7 or newer from https://www.python.org/downloads/" -ForegroundColor Yellow
        return $false
    }
}

# Check for Python
if (-not (Check-Python)) {
    Write-Host "Exiting because Python is required to run the server." -ForegroundColor Red
    exit 1
}

# Run the server script
Write-Host "Starting NecroBET server..." -ForegroundColor Cyan
Write-Host "The application will be available at http://127.0.0.1:4173" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Yellow

try {
    python server.py
} catch {
    Write-Host "Error running the server: $_" -ForegroundColor Red
}
