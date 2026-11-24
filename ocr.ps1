# The text of a picture, as Windows' own text recognition (Windows.Media.Ocr) reads it: serve.py read_screen() gives it
# a picture of the game's window on its input (a BMP, in memory: it is written nowhere) and takes the lines it prints,
# one per line, in UTF-8. Every language the system can read is tried (the game may be in another language than
# Windows): a line read twice the same is printed once.
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$bytes = New-Object IO.MemoryStream
[Console]::OpenStandardInput().CopyTo($bytes)
$bytes.Position = 0
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync([IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($bytes))) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$seen = @{}
foreach ($lang in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
  $read = Await ([Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang).RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  foreach ($line in $read.Lines) { if (-not $seen[$line.Text]) { $seen[$line.Text] = $true; $line.Text } }
}
