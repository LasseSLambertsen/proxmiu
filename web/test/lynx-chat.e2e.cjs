// After npm run build:web: CHROMIUM_PATH=/usr/bin/chromium node web/test/lynx-chat.e2e.cjs
// Provider and agent responses are fixtures. No provider or Proxmox host is contacted.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '../../dist/web')
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let file = path.resolve(root, `.${pathname}`)
    if (!file.startsWith(`${root}/`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html')
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(5000)
    const failures = []
    page.on('pageerror', error => failures.push(error.message))
    let settings = { configured: true, provider: 'openai', model: 'fixture-model' }
    let failNext = false
    let holdReply
    let holdNext = false
    const sends = []
    await page.route('**/api/**', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      let data = []
      if (pathname === '/api/health') data = { name: 'proxmiu-agent', version: 'fixture', authRequired: false }
      else if (pathname === '/api/auth/status') data = { authRequired: false, authenticated: true }
      else if (pathname === '/api/overview') data = { clusters: [] }
      else if (pathname === '/api/guest-metadata') data = {}
      else if (pathname === '/api/settings') data = { sshPublicKey: 'ssh-ed25519 fixture', sshKeyCreatedAt: new Date().toISOString(), authRequired: false }
      else if (pathname === '/api/self-update') data = { enabled: false, status: { state: 'idle' } }
      else if (pathname === '/api/ai/context') data = { clusters: [], unavailableConnections: 0 }
      else if (pathname === '/api/ai/settings') {
        if (request.method() === 'PUT') {
          const body = request.postDataJSON()
          settings = { configured: true, provider: body.provider, model: body.model }
        } else if (request.method() === 'DELETE') settings = { ...settings, configured: false }
        data = settings
      } else if (pathname === '/api/ai/chat') {
        assert.equal(request.method(), 'POST')
        const body = request.postDataJSON()
        assert.deepEqual(Object.keys(body), ['messages'], 'No automatic inventory, credentials or setup data is attached')
        sends.push(body)
        if (holdNext) {
          holdNext = false
          await new Promise(resolve => { holdReply = resolve })
        }
        if (failNext) {
          failNext = false
          return route.fulfill({ status: 502, json: { error: 'Provider unavailable. Try again.' } })
        }
        data = { reply: '<img src=x onerror="window.chatInjected=true"> Fixture reply' }
      }
      await route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.address().port}`
    await page.goto(base)
    const wake = () => page.locator('[data-lynx-wake]:visible')
    await wake().waitFor()
    await page.getByRole('button', { name: 'Chat with Lynx', exact: true }).waitFor()
    await wake().click()
    const dialog = page.getByRole('dialog', { name: 'Chat with Lynx' })
    await dialog.waitFor()
    assert.equal(await page.locator('#proxmiu-lynx').count(), 0)
    assert.match(await dialog.textContent(), /OpenAI/)
    assert.match(await dialog.textContent(), /fixture-model/)
    assert.match(await dialog.textContent(), /No setup data is attached automatically/)
    const draft = dialog.getByRole('textbox', { name: 'Message Lynx' })
    assert.ok(await draft.evaluate(element => element === document.activeElement))
    await draft.fill('How do I check backups?')
    await draft.press('Enter')
    await dialog.getByText(/Fixture reply/).waitFor()
    assert.deepEqual(sends[0], { messages: [{ role: 'user', content: 'How do I check backups?' }] })
    assert.equal(await dialog.locator('img[onerror]').count(), 0)
    assert.equal(await page.evaluate(() => window.chatInjected), undefined)
    await draft.fill('Follow up')
    await draft.press('Shift+Enter')
    await draft.press('x')
    assert.equal(sends.length, 1)
    assert.equal(await draft.inputValue(), 'Follow up\nx')
    failNext = true
    await draft.press('Enter')
    await dialog.getByRole('alert').waitFor()
    assert.equal(await draft.inputValue(), 'Follow up\nx', 'Failure preserves draft')
    assert.equal(await dialog.locator('[data-chat-message="user"]').count(), 1, 'Failure does not duplicate the user turn')
    await dialog.getByRole('button', { name: 'Retry message' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message="assistant"]').length === 2)
    assert.deepEqual(sends[1], sends[2], 'Retry sends the same successful history and draft once')
    assert.deepEqual(sends[2].messages.map(message => message.role), ['user', 'assistant', 'user'])
    await dialog.getByRole('button', { name: 'Clear conversation' }).click()
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0)
    await draft.fill('compose')
    await draft.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
    assert.equal(sends.length, 3, 'IME composition must not send')
    await draft.fill('a'.repeat(4001))
    assert.ok(await dialog.getByRole('button', { name: 'Send message' }).isDisabled())
    await draft.fill('Remember me')
    holdNext = true
    await draft.press('Enter')
    await page.waitForFunction(() => !!document.querySelector('[aria-label="Lynx is replying"]'))
    await draft.press('Enter')
    assert.equal(sends.length, 4, 'Pending request cannot duplicate sends')
    holdReply()
    await dialog.getByText(/Fixture reply/).waitFor()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement?.matches('[data-lynx-wake]'))
    assert.ok(await wake().evaluate(element => element === document.activeElement), 'Dialog restores trigger focus')
    for (let i = 0; i < 5; i++) await page.locator('[data-lynx-trigger]:visible').click()
    await dialog.waitFor()
    assert.match(await dialog.textContent(), /Remember me/, 'Closing preserves memory-only conversation')
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('combobox', { name: 'Provider' }).selectOption('anthropic')
    await page.getByRole('textbox', { name: 'API token' }).fill('fixture-key')
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await page.getByText('Token saved on your agent').waitFor()
    await wake().click()
    await dialog.waitFor()
    assert.match(await dialog.textContent(), /Anthropic/)
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Provider change resets transcript')
    assert.equal(await draft.inputValue(), '')
    await draft.fill('Anthropic fixture question')
    await draft.press('Enter')
    await dialog.getByText(/Fixture reply/).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('combobox', { name: 'Provider' }).selectOption('openrouter')
    assert.equal(await page.getByRole('textbox', { name: 'Model', exact: true }).inputValue(), 'openai/gpt-4o-mini', 'OpenRouter uses a namespaced default model')
    await page.getByRole('textbox', { name: 'API token' }).fill('openrouter-fixture-key')
    const openRouterSaved = page.waitForResponse(response => response.url().endsWith('/api/ai/settings') && response.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await openRouterSaved
    assert.equal(settings.provider, 'openrouter')
    assert.equal(settings.model, 'openai/gpt-4o-mini')
    await page.getByRole('button', { name: 'Preview inventory' }).click()
    await page.getByText(/This exact inventory will be sent to OpenRouter/).waitFor()
    await wake().click()
    await dialog.waitFor()
    assert.match(await dialog.textContent(), /OpenRouter · openai\/gpt-4o-mini/)
    assert.match(await dialog.textContent(), /conversation are sent to OpenRouter/)
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Switching to OpenRouter clears the previous provider conversation')
    assert.equal(await draft.inputValue(), '')
    await draft.fill('OpenRouter fixture question')
    await draft.press('Enter')
    await dialog.getByText(/Fixture reply/).waitFor()
    assert.deepEqual(sends.at(-1), { messages: [{ role: 'user', content: 'OpenRouter fixture question' }] })
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: 'Model', exact: true }).fill('changed-model')
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="API token"]').value === '' && Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Save AI settings') && button.disabled))
    await page.setViewportSize({ width: 390, height: 844 })
    await wake().click()
    await dialog.waitFor()
    assert.match(await dialog.textContent(), /changed-model/)
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Model change resets transcript')
    await draft.fill('mobile draft')
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'lynx-chat-mobile-fixture.png') })
    }
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Remove token', exact: true }).click()
    await page.getByRole('dialog', { name: 'Remove the saved AI token?' }).getByRole('button', { name: 'Remove token', exact: true }).click()
    await page.getByText('No AI token configured').waitFor()
    await wake().click()
    await page.getByRole('button', { name: 'Pet the lynx' }).waitFor()
    assert.equal(await dialog.count(), 0, 'Removing a key immediately restores decorative fallback')
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: 'API token' }).fill('new-fixture-key')
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await page.getByText('Token saved on your agent').waitFor()
    await wake().click()
    await dialog.waitFor()
    assert.equal(await draft.inputValue(), '', 'Removing and saving a key drops old drafts')
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0)
    // Clearing during an in-flight request invalidates its eventual response.
    holdNext = true
    await draft.fill('Discard this late reply')
    await draft.press('Enter')
    await dialog.locator('[aria-label="Lynx is replying"]').waitFor()
    await dialog.getByRole('button', { name: 'Clear conversation' }).click()
    const lateReply = page.waitForResponse(response => response.url().endsWith('/api/ai/chat'))
    holdReply()
    await lateReply
    await draft.fill('Still fresh')
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Late cleared reply cannot restore history')
    await dialog.getByRole('button', { name: 'Clear conversation' }).click()
    // A request never crosses the 20,000-character conversation bound.
    for (let turn = 0; turn < 4; turn++) {
      await draft.fill('a'.repeat(4000))
      await draft.press('Enter')
      await page.waitForFunction(count => document.querySelectorAll('[data-chat-message="assistant"]').length === count, turn + 1)
    }
    await draft.fill('a'.repeat(4000))
    assert.ok(await dialog.getByRole('button', { name: 'Send message' }).isDisabled())
    assert.match(await dialog.textContent(), /conversation is too long/)
    await dialog.getByRole('button', { name: 'Clear conversation' }).click()
    // Ten complete turns use the allowed 19-message final request; no 21st message is sent.
    for (let turn = 0; turn < 10; turn++) {
      await draft.fill(`Question ${turn}`)
      await draft.press('Enter')
      await page.waitForFunction(count => document.querySelectorAll('[data-chat-message="assistant"]').length === count, turn + 1)
    }
    assert.equal(sends.at(-1).messages.length, 19)
    await draft.fill('Over the limit')
    assert.ok(await dialog.getByRole('button', { name: 'Send message' }).isDisabled())
    assert.match(await dialog.textContent(), /conversation reached its message limit/)
    for (const { messages } of sends) {
      assert.ok(messages.length <= 20)
      assert.ok(messages.every(message => message.content.length <= 4000))
      assert.ok(messages.reduce((sum, message) => sum + message.content.length, 0) <= 20000)
    }
    await dialog.getByRole('button', { name: 'Clear conversation' }).click()
    // Removing the key while a response is pending closes the chat and invalidates that response.
    holdNext = true
    await draft.fill('Old provider response')
    await draft.press('Enter')
    await dialog.locator('[aria-label="Lynx is replying"]').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Remove token', exact: true }).click()
    await page.getByRole('dialog', { name: 'Remove the saved AI token?' }).getByRole('button', { name: 'Remove token', exact: true }).click()
    await page.getByText('No AI token configured').waitFor()
    const removedReply = page.waitForResponse(response => response.url().endsWith('/api/ai/chat'))
    holdReply()
    await removedReply
    await page.getByRole('textbox', { name: 'API token' }).fill('last-fixture-key')
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await page.getByText('Token saved on your agent').waitFor()
    await wake().click()
    await dialog.waitFor()
    assert.equal(await dialog.locator('[data-chat-message]').count(), 0, 'Late reply after key removal cannot reappear')
    assert.equal(await draft.inputValue(), '')
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => /chat|lynx/.test(key))), [], 'Chat is never persisted')
    assert.deepEqual(failures, [])
    console.log('PASS: configured chat, provider disclosure, payload privacy, plaintext, followups, errors/retry, duplicate prevention, clear, limits, IME, focus return, logo wake, live OpenAI/Anthropic/OpenRouter selection, inventory disclosure, provider/model/key changes and 390px mobile (fixture responses)')
  } finally {
    if (browser) await browser.close()
    server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
