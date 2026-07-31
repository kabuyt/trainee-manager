param(
  [string[]]$Kumiai = @("globalway", "cic", "worldbusiness", "tombow", "sanyotech"),
  [string]$Ymd = "",
  [string]$CommitMessage = "reports: 月次更新",
  [switch]$SkipGenerate,
  [switch]$SkipGit,
  [switch]$NoAll,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$repoFullPath = [System.IO.Path]::GetFullPath($repo).TrimEnd('\') + '\'

$groups = @{
  globalway     = @{ Password = "globalway2026" }
  cic           = @{ Password = "cic2026" }
  worldbusiness = @{ Password = "worldbusiness2026" }
  tombow        = @{ Password = "tombow2026" }
  sanyotech     = @{ Password = "sanyotech2026" }
}

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Action
  )
  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  & $Action
}

function Assert-PathInsideRepo {
  param([string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repo $Path))
  if (-not $fullPath.StartsWith($repoFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside repository: $fullPath"
  }
  return $fullPath
}

foreach ($slug in $Kumiai) {
  if (-not $groups.ContainsKey($slug)) {
    throw "Unknown kumiai slug: $slug"
  }
}

if (-not $SkipGenerate) {
  foreach ($slug in $Kumiai) {
    Invoke-Step "Generate $slug" {
      $argsList = @("bulk_pdf.py", "--kumiai", $slug, "--auto-month", "--site", "--password", $groups[$slug].Password)
      if (-not $NoAll) { $argsList += "--all" }
      if ($Ymd) { $argsList += @("--ymd", $Ymd) }

      if ($DryRun) {
        Write-Host ("DRY RUN: python " + ($argsList -join " ")) -ForegroundColor Yellow
        return
      }

      & python @argsList
      if ($LASTEXITCODE -ne 0) {
        throw "bulk_pdf.py failed for $slug with exit code $LASTEXITCODE"
      }
    }
  }
}

Invoke-Step "Sync reports_pdf to reports" {
  New-Item -ItemType Directory -Force -Path "reports" | Out-Null

  foreach ($slug in $Kumiai) {
    $src = Join-Path "reports_pdf" $slug
    $dst = Join-Path "reports" $slug
    $dstFullPath = Assert-PathInsideRepo $dst

    if (Test-Path -LiteralPath $dst) {
      if ($DryRun) {
        Write-Host "DRY RUN: remove $dst" -ForegroundColor Yellow
      } else {
        Remove-Item -LiteralPath $dstFullPath -Recurse -Force
      }
    }

    if (Test-Path -LiteralPath $src) {
      if ($DryRun) {
        Write-Host "DRY RUN: copy $src -> $dst" -ForegroundColor Yellow
      } else {
        Copy-Item -LiteralPath $src -Destination $dstFullPath -Recurse
      }
      Write-Host "Published $slug" -ForegroundColor Green
    } else {
      Write-Host "Skipped ${slug}: no generated reports this time" -ForegroundColor Yellow
    }
  }
}

if (-not $SkipGit) {
  Invoke-Step "Commit and push reports" {
    if ($DryRun) {
      Write-Host "DRY RUN: git add reports/; git commit; git push" -ForegroundColor Yellow
      return
    }

    git add reports/

    $staged = git diff --cached --name-only -- reports/
    if (-not $staged) {
      Write-Host "No report changes to commit." -ForegroundColor Yellow
      return
    }

    git commit -m $CommitMessage
    if ($LASTEXITCODE -ne 0) {
      throw "git commit failed with exit code $LASTEXITCODE"
    }

    git push
    if ($LASTEXITCODE -ne 0) {
      throw "git push failed with exit code $LASTEXITCODE"
    }
  }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
