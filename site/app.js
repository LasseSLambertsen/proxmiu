const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(area)
  if (!ok) throw new Error('copy failed')
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const block = button.closest('.code-block')
    const code = block?.querySelector('code')
    if (!code) return
    const original = button.textContent
    try {
      await copyText(code.textContent ?? '')
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select and copy'
    }
    window.setTimeout(() => {
      button.textContent = original
    }, 1600)
  })
})
