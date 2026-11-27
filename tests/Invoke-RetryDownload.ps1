# Downloads a URL with Invoke-WebRequest; a 5xx is retried three times (1s, 2s, 4s), a 4xx or a network error fails at once.
function Invoke-RetryDownload($Uri, $Out) {
  for ($attempt = 0; ; $attempt++) {
    try { Invoke-WebRequest $Uri -OutFile $Out; return }
    catch {
      $status = 0
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      if ($status -lt 500 -or $attempt -ge 3) { throw }
      Start-Sleep -Seconds ([math]::Pow(2, $attempt))
    }
  }
}