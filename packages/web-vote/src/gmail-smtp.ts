import nodemailer from 'nodemailer'
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls'
import type { MailSettings, SignupMail } from './signup-mail'

export function openGmailSocket(
  connectSocket: (options: ConnectionOptions) => TLSSocket = tlsConnect
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    // Workers' socket proxy supports hostname TLS; avoid Nodemailer's address-family lookup path.
    const socket = connectSocket({
      host: 'smtp.gmail.com',
      port: 465,
      servername: 'smtp.gmail.com',
      rejectUnauthorized: true
    })
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      socket.removeListener('error', fail)
      socket.removeListener('close', closed)
      socket.removeListener('secureConnect', connected)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      socket.destroy()
      reject(Object.assign(error, { command: 'CONN' }))
    }
    const closed = () =>
      fail(Object.assign(new Error('MAIL_CONNECT_CLOSED'), { code: 'MAIL_CONNECT_CLOSED' }))
    const connected = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(socket)
    }
    const timer = setTimeout(
      () => fail(Object.assign(new Error('MAIL_CONNECT_TIMEOUT'), { code: 'ETIMEDOUT' })),
      10000
    )
    socket.on('error', fail)
    socket.once('close', closed)
    socket.once('secureConnect', connected)
  })
}

export async function sendGmail(settings: MailSettings, mail: SignupMail): Promise<void> {
  const socket = await openGmailSocket()
  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      connection: socket,
      secured: true,
      auth: { user: settings.username, pass: settings.password },
      tls: { servername: 'smtp.gmail.com', rejectUnauthorized: true },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false
    })
    try {
      const receipt = await transport.sendMail(mail)
      if (!receipt.accepted?.includes(mail.to)) throw new Error('MAIL_ACCEPTANCE_UNCONFIRMED')
    } finally {
      transport.close()
    }
  } finally {
    socket.destroy()
  }
}
