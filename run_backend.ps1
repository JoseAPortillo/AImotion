$venvPath = ".venv\Scripts\Activate"

if (Test-Path $venvPath) {
    Write-Host "Activando entorno virtual..."
    & $venvPath

    $env:PYTHONPATH = 'src/backend'; uvicorn app.main:app --reload --reload-dir src/backend --port 8001
} else {
    Write-Host "No se encontró el entorno virtual en $venvPath"
}

