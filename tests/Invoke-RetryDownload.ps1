# Downloads a URL with Invoke-WebRequest; a 5xx is retried three times (1s, 2s, 4s), a 4xx or a network error fails at once.
# -UseBasicParsing keeps Windows PowerShell 5.1 working without the IE engine; it is a no-op in PowerShell 7.
function Invoke-RetryDownload($Uri, $Out) {
  $ProgressPreference = 'SilentlyContinue'
  for ($attempt = 0; ; $attempt++) {
    try { Invoke-WebRequest $Uri -UseBasicParsing -OutFile $Out; return }
    catch {
      $status = 0
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      if ($status -lt 500 -or $attempt -ge 3) { throw }
      Start-Sleep -Seconds ([math]::Pow(2, $attempt))
    }
  }
}