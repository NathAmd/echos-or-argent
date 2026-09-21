import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLanLaunchAgentPlist,
  lanLaunchAgentFileName,
  lanLaunchAgentLabel,
  resolveLanLaunchAgentPaths,
  writeLaunchAgentPlistAtomically,
} from './manage-lan-launch-agent.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('gestionnaire macOS du serveur privé LAN', () => {
  it('résout uniquement des chemins absolus sans dépendre de HOME ou du shell', () => {
    expect(resolveLanLaunchAgentPaths({
      homeDirectory: '/Users/tester',
      nodeExecutable: '/opt/node/bin/node',
      webDirectory: '/Volumes/Work/PokeMaster/web',
    })).toEqual({
      errorLog: '/Volumes/Work/PokeMaster/web/.lan/logs/launch-agent-error.log',
      launchAgentsDirectory: '/Users/tester/Library/LaunchAgents',
      logDirectory: '/Volumes/Work/PokeMaster/web/.lan/logs',
      nodeExecutable: '/opt/node/bin/node',
      outputLog: '/Volumes/Work/PokeMaster/web/.lan/logs/launch-agent-output.log',
      plist: `/Users/tester/Library/LaunchAgents/${lanLaunchAgentFileName}`,
      runnerScript: '/Volumes/Work/PokeMaster/web/scripts/run-lan-development.mjs',
      webDirectory: '/Volumes/Work/PokeMaster/web',
    })
    expect(() => resolveLanLaunchAgentPaths({
      homeDirectory: 'Users/tester',
      nodeExecutable: 'node',
      webDirectory: '/workspace/web',
    })).toThrow('absolu')
  })

  it('produit une définition stricte, supervisée et dépourvue de secrets', () => {
    const paths = resolveLanLaunchAgentPaths({
      homeDirectory: '/Users/tester',
      nodeExecutable: '/opt/Node & Tools/bin/node',
      webDirectory: '/Volumes/Work & Games/PokeMaster/web',
    })
    const plist = createLanLaunchAgentPlist(paths)
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])

    expect(keys).toEqual([
      'Label',
      'ProgramArguments',
      'WorkingDirectory',
      'RunAtLoad',
      'KeepAlive',
      'NetworkState',
      'SuccessfulExit',
      'ThrottleInterval',
      'ExitTimeOut',
      'ProcessType',
      'AbandonProcessGroup',
      'Umask',
      'StandardOutPath',
      'StandardErrorPath',
    ])
    expect(plist).toContain(`<string>${lanLaunchAgentLabel}</string>`)
    expect(plist).toContain('<string>/opt/Node &amp; Tools/bin/node</string>')
    expect(plist).toContain('<string>--managed</string>')
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plist).toContain('<key>SuccessfulExit</key>\n    <false/>')
    expect(plist).toContain('<key>ThrottleInterval</key>\n  <integer>30</integer>')
    expect(plist).not.toMatch(/EnvironmentVariables|\.pem|token|password|secret/i)
  })

  it('écrit et remplace le plist atomiquement dans un dossier isolé', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pokemaster-launch-agent-')))
    temporaryDirectories.push(root)
    const target = join(root, 'Library', 'LaunchAgents', lanLaunchAgentFileName)
    const validate = vi.fn(async (temporaryPath) => {
      expect(temporaryPath).toContain(`.${lanLaunchAgentFileName}.`)
      expect(await readFile(temporaryPath, 'utf8')).toBe('first')
    })

    await writeLaunchAgentPlistAtomically(target, 'first', { validate })
    expect(validate).toHaveBeenCalledOnce()
    expect(await readFile(target, 'utf8')).toBe('first')
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(root, 'Library', 'LaunchAgents'))).toEqual([lanLaunchAgentFileName])

    await writeLaunchAgentPlistAtomically(target, 'second')
    expect(await readFile(target, 'utf8')).toBe('second')
    expect(await readdir(join(root, 'Library', 'LaunchAgents'))).toEqual([lanLaunchAgentFileName])
  })

  it('conserve l’ancienne définition si la validation de la nouvelle échoue', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pokemaster-launch-agent-failure-')))
    temporaryDirectories.push(root)
    const target = join(root, 'LaunchAgents', lanLaunchAgentFileName)
    await writeLaunchAgentPlistAtomically(target, 'stable')

    await expect(writeLaunchAgentPlistAtomically(target, 'invalid', {
      validate: async () => { throw new Error('plist invalide') },
    })).rejects.toThrow('plist invalide')
    expect(await readFile(target, 'utf8')).toBe('stable')
    expect(await readdir(join(root, 'LaunchAgents'))).toEqual([lanLaunchAgentFileName])
  })
})
