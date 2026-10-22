param(
  [Parameter(Mandatory = $true)]
  [string]$Email
)

$primeiraProtegida = Read-Host "Nova senha (nao aparece)" -AsSecureString
$segundaProtegida = Read-Host "Repita a nova senha" -AsSecureString
$ponte1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($primeiraProtegida)
$ponte2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segundaProtegida)

try {
  $primeira = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponte1)
  $segunda = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponte2)
  if ($primeira -cne $segunda) { throw "As senhas nao conferem." }
  $primeira | node "$PSScriptRoot/redefinirSenhaEquipe.mjs" $Email
  if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel atualizar a senha." }
}
finally {
  if ($ponte1 -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponte1) }
  if ($ponte2 -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponte2) }
  $primeira = $null
  $segunda = $null
}
