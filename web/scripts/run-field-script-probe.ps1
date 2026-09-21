param(
	[string]$TestName = '',
	[string]$OutputFile = '.field-script-probe.json'
)

$ErrorActionPreference = 'Stop'

Set-Location 'c:\Users\nath7\Documents\Project\PokeMaster\web'
$env:RUN_ROM_PROBES = '1'

$vitestArgs = @('run', 'src/fieldScriptProbe.test.ts', '--reporter=json', "--outputFile=$OutputFile")
if ($TestName) {
	$vitestArgs += @('-t', $TestName)
}

& '.\node_modules\.bin\vitest.cmd' @vitestArgs