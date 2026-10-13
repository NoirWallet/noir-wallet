export interface MailSecrets {
  SMTP_USER?: string
  SMTP_APP_PASSWORD?: string
  SIGNUP_MAIL_CONFIG?: string
}

interface MailTemplate {
  subject: string
  preheader: string
  title: string
  paragraphs: string[]
  button?: { text: string; url: string }
}

export interface MailSettings {
  username: string
  password: string
  template: MailTemplate
}

export interface SignupMail {
  from: string
  replyTo: string
  to: string
  subject: string
  messageId: string
  html: string
  text: string
}

function invalid(): never {
  throw new Error('MAIL_CONFIGURATION_INVALID')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, header = false): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\x00/.test(value))
    return invalid()
  if (header && /[\r\n]/.test(value)) return invalid()
  return value.trim()
}

function address(value: string): string {
  if (value.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(value))
    return invalid()
  return value
}

export function readMailSettings(env: MailSecrets): MailSettings {
  const username = address(text(env.SMTP_USER, 254, true))
  const password = text(env.SMTP_APP_PASSWORD, 64, true).replace(/ /g, '')
  if (!/^[a-zA-Z0-9]{16}$/.test(password)) return invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(text(env.SIGNUP_MAIL_CONFIG, 24000))
  } catch {
    return invalid()
  }
  const config = record(parsed)
  if (
    Object.keys(config).some(
      key => !['subject', 'preheader', 'title', 'paragraphs', 'button'].includes(key)
    )
  )
    return invalid()
  if (
    !Array.isArray(config.paragraphs) ||
    config.paragraphs.length < 1 ||
    config.paragraphs.length > 20
  )
    return invalid()
  const template: MailTemplate = {
    subject: text(config.subject, 200, true),
    preheader: config.preheader === undefined ? '' : text(config.preheader, 300),
    title: text(config.title, 200),
    paragraphs: config.paragraphs.map(value => text(value, 3000))
  }
  if (config.button !== undefined) {
    const button = record(config.button)
    const urlText = text(button.url, 2048, true)
    let url: URL
    try {
      url = new URL(urlText)
    } catch {
      return invalid()
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      Object.keys(button).some(key => !['text', 'url'].includes(key))
    )
      return invalid()
    template.button = { text: text(button.text, 100), url: url.href }
  }
  return { username, password, template }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  )
}

export function renderSignupMail(
  template: MailTemplate,
  recipient: string,
  id: string
): SignupMail {
  address(recipient)
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return invalid()
  const paragraphs = template.paragraphs
    .map(
      value =>
        `<p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#41414f">${escapeHtml(value).replace(/\r?\n/g, '<br>')}</p>`
    )
    .join('')
  const button = template.button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#00d18a" style="border-radius:8px"><a href="${escapeHtml(template.button.url)}" style="display:inline-block;padding:15px 25px;color:#12121c;text-decoration:none;font-size:15px;font-weight:bold">${escapeHtml(template.button.text)}</a></td></tr></table>`
    : ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(template.subject)}</title></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(template.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e7e7ec;border-radius:8px;overflow:hidden"><tr><td bgcolor="#12121c" style="padding:28px 32px"><a href="https://www.zknoir.com/" style="text-decoration:none;color:#ffffff;font-family:Georgia,serif;font-size:28px">Noir <span style="color:#00d18a">Wallet</span></a></td></tr><tr><td style="padding:32px"><div style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#008859;margin-bottom:16px">FROST EARLY SIGNUP</div><h1 style="margin:0 0 24px;color:#12121c;font-family:Georgia,serif;font-size:30px;line-height:1.25">${escapeHtml(template.title)}</h1>${paragraphs}${button}<hr style="border:0;border-top:1px solid #ededf1;margin:28px 0"><p style="margin:0;font-size:12px;line-height:1.7;color:#777783">NoirWallet · Privacy Beyond Chains.<br><a href="mailto:support@zknoir.com" style="color:#008859;text-decoration:none">support@zknoir.com</a></p></td></tr></table></td></tr></table></body></html>`
  return {
    from: 'NoirWallet <support@zknoir.com>',
    replyTo: 'support@zknoir.com',
    to: recipient,
    subject: template.subject,
    messageId: `<frost-${id}@zknoir.com>`,
    html,
    text: [
      template.title,
      ...template.paragraphs,
      ...(template.button ? [`${template.button.text}: ${template.button.url}`] : []),
      'NoirWallet — Privacy Beyond Chains.',
      'support@zknoir.com'
    ].join('\n\n')
  }
}
