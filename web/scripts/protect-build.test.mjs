import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const protectorPath = fileURLToPath(new URL('./protect-build.mjs', import.meta.url))
const applicationName = 'app-0123456789abcdef.js'
const stylesheetName = 'asset-0123456789abcdef.css'
const temporaryDirectories = []

function buildHtml(scriptTag = `<script type="module" src="/assets/${applicationName}"></script>`) {
  return `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><title>Fixture</title>${scriptTag}<link rel="stylesheet" href="/assets/${stylesheetName}"></head><body></body></html>`
}

async function createFixture(html = buildHtml()) {
  const root = await mkdtemp(join(tmpdir(), 'pokemaster-build-protection-'))
  temporaryDirectories.push(root)
  const assets = join(root, 'dist', 'assets')
  await mkdir(assets, { recursive: true })
  await Promise.all([
    writeFile(join(root, 'dist', 'index.html'), html),
    writeFile(join(assets, applicationName), 'export const fixture = true;\n'),
    writeFile(join(assets, stylesheetName), 'body { color: white; }\n'),
  ])
  return root
}

async function runProtectorWithEnvironment(root, extraEnvironment, ...arguments_) {
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('POKEMASTER_'))), ...extraEnvironment }
  try {
    const result = await execFileAsync(process.execPath, [protectorPath, ...arguments_], {
      cwd: root,
      env: environment,
    })
    return { status: 0, output: `${result.stdout}${result.stderr}` }
  } catch (error) {
    return {
      status: typeof error?.code === 'number' ? error.code : 1,
      output: `${error?.stdout ?? ''}${error?.stderr ?? ''}`,
    }
  }
}

async function runProtector(root, ...arguments_) {
  return runProtectorWithEnvironment(root, {}, ...arguments_)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('protection du build distribué', () => {
  it('analyse correctement un chevron cité et ajoute les empreintes SRI', async () => {
    const root = await createFixture(buildHtml(`<script data-note=">" type="module" src=/assets/${applicationName}></script>`))

    const result = await runProtector(root)
    const html = await readFile(join(root, 'dist', 'index.html'), 'utf8')

    expect(result.status, result.output).toBe(0)
    expect(html.match(/integrity="sha384-/g)).toHaveLength(2)
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'))
  })

  it('autorise uniquement les origines HTTPS/WSS explicites du serveur public', async () => {
    const root = await createFixture()
    const finalized = await runProtectorWithEnvironment(root, {
      POKEMASTER_PUBLIC_ONLINE_SERVER_URL: 'https://online.example.com/api',
      POKEMASTER_PUBLIC_RTC_ICE_SERVERS: '[{"urls":["stun:stun.example.com:3478"]}]',
    })
    const html = await readFile(join(root, 'dist', 'index.html'), 'utf8')

    expect(finalized.status, finalized.output).toBe(0)
    expect(html).toContain('https://online.example.com wss://online.example.com')
    expect(html).not.toContain('stun.example.com')
    expect((await runProtector(root, '--verify')).status).toBe(0)
  })

  it('protège puis vérifie un build publié sous le sous-chemin GitHub Pages', async () => {
    const root = await createFixture(buildHtml(
      `<script type="module" src="/PokeMaster/assets/${applicationName}"></script>`,
    ).replace(`/assets/${stylesheetName}`, `/PokeMaster/assets/${stylesheetName}`))
    const finalized = await runProtectorWithEnvironment(root, {
      POKEMASTER_PUBLIC_BASE_PATH: '/PokeMaster/',
    })

    expect(finalized.status, finalized.output).toBe(0)
    await expect(readFile(join(root, 'dist', 'integrity-manifest.json'), 'utf8'))
      .resolves.toContain('"publicBasePath": "/PokeMaster/"')
    expect((await runProtector(root, '--verify')).status).toBe(0)
  })

  it('refuse un manifeste web qui sortirait du sous-chemin GitHub Pages', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'dist', 'site.webmanifest'), JSON.stringify({
      start_url: '/',
      scope: '/',
      icons: [],
    }))

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('start_url et un scope relatifs')
  })

  it.each([
    'http://online.example.com',
    'https://user:secret@online.example.com',
    'https://online.example.com?token=secret',
  ])('refuse une origine serveur publique dangereuse (%s)', async (url) => {
    const root = await createFixture()
    const result = await runProtectorWithEnvironment(root, { POKEMASTER_PUBLIC_ONLINE_SERVER_URL: url })

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('URL HTTPS publique')
  })

  it('refuse tout script inline, même avant la balise charset', async () => {
    const inline = `<script>globalThis.compromised = true</script><meta charset="UTF-8"><script type="module" src="/assets/${applicationName}"></script>`
    const html = `<!doctype html><html><head>${inline}<link rel="stylesheet" href="/assets/${stylesheetName}"></head><body></body></html>`
    const root = await createFixture(html)

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('scripts inline')
  })

  it.each([
    ['HTTPS non cité', '<script type=module src=https://evil.example/app.js></script>'],
    ['schéma relatif ambigu', `<script type="module" src="http:evil.example/assets/${applicationName}"></script>`],
    ['data en majuscules', '<script type="module" src="DATA:text/javascript,alert(1)"></script>'],
    ['espace initial', `<script type="module" src=" https://evil.example/assets/${applicationName}"></script>`],
    ['antislash', `<script type="module" src="\\\\evil.example\\assets\\${applicationName}"></script>`],
    ['séparateur encodé', `<script type="module" src="/assets%2f${applicationName}"></script>`],
  ])('refuse une URL de ressource ambiguë ou externe (%s)', async (_label, script) => {
    const root = await createFixture(buildHtml(script))

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toMatch(/(?:ambigu|canonique|externe).*interdit|interdite.*(?:ambigu|canonique|externe)/i)
  })

  it('refuse les attributs dupliqués signalés par le parseur HTML', async () => {
    const script = `<script type="module" src="/assets/${applicationName}" src="https://evil.example/app.js"></script>`
    const root = await createFixture(buildHtml(script))

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('duplicate-attribute')
  })

  it('refuse le JavaScript public brut hors des bundles versionnés', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'dist', 'public-helper.js'), 'alert(1)\n')

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('JavaScript public')
  })

  it('refuse une page HTML secondaire qui échapperait à la CSP et au SRI', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'dist', 'other.html'), '<!doctype html><script>alert(1)</script>\n')

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('Page HTML secondaire')
  })

  it('refuse les références de source sans dépendre de leur casse', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'dist', 'assets', stylesheetName), '/*# SourceMappingURL=private.css.map */\n')

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('source interdite')
  })

  it.each([
    ['JavaScript', applicationName, 'export const leak = "pokemaster-debug-tape-v1";\n'],
    ['CSS', stylesheetName, '.realtime-test-panel { display: block; }\n'],
    ['CSS bot', stylesheetName, '.bot-controls { display: block; }\n'],
    ['HTML', '../index.html', buildHtml().replace('</body>', '<div data-realtime-test-run></div></body>')],
  ])('refuse un outil DEV publié dans le %s', async (_label, target, content) => {
    const root = await createFixture()
    await writeFile(join(root, 'dist', 'assets', target), content).catch(async () => {
      await writeFile(join(root, 'dist', 'index.html'), content)
    })

    const result = await runProtector(root)

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('Fonction de développement publiée')
  })

  it('détecte toute modification après finalisation', async () => {
    const root = await createFixture()
    const finalized = await runProtector(root)
    expect(finalized.status, finalized.output).toBe(0)
    await writeFile(join(root, 'dist', 'assets', applicationName), 'export const fixture = false;\n')

    const verified = await runProtector(root, '--verify')

    expect(verified.status).not.toBe(0)
    expect(verified.output).toContain('Fichier de build modifié')
  })
})
