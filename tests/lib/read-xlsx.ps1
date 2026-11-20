param([string]$file)
$x = New-Object -ComObject Excel.Application; $x.DisplayAlerts = $false
try {
  $wb = $x.Workbooks.Open($file, 0, $true)
  $out = [ordered]@{ ok = $true; sheets = @{} }
  foreach ($ws in $wb.Worksheets) { $used = $ws.UsedRange; $out.sheets[$ws.Name] = [math]::Max(0, $used.Rows.Count - 1) }
  $lost = $wb.Worksheets.Item("Lost reports"); $out.lostA2 = $lost.Range("A2").Text; $out.lostOwner = $lost.Range("Q2").Text
  $f = $wb.Worksheets.Item("Found items"); $out.foundPrivate = $f.Range("K2").Text
  $u = $wb.Worksheets.Item("Users"); $out.userHeaders = (1..11 | ForEach-Object { $u.Cells.Item(1, $_).Text }) -join "|"
  $out.libraries = @($lost.UsedRange.Columns.Item(2).Value2 | Select-Object -Skip 1 | Sort-Object -Unique)
  $out.summaryScope = $wb.Worksheets.Item("Summary").Range("B2").Text
  $wb.Close($false)
} catch { $out = @{ ok = $false; error = $_.Exception.Message } } finally { $x.Quit(); [System.Runtime.Interopservices.Marshal]::ReleaseComObject($x) | Out-Null }
$out | ConvertTo-Json -Compress -Depth 4
