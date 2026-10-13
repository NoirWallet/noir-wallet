import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import nodemailer from 'nodemailer'
import { openGmailSocket } from '../src/gmail-smtp.ts'
import {
  deliverNextSignup,
  deliveryOutcome,
  ensureMailAlarm,
  mailDiagnostic,
  scheduleNextMail
} from '../src/mail-delivery.ts'
import { readMailSettings, renderSignupMail } from '../src/signup-mail.ts'
import { SignupStore } from '../src/signup-store.ts'

const secrets = {
  SMTP_USER: 'support@zknoir.com',
  SMTP_APP_PASSWORD: 'abcd efgh ijkl mnop',
  SIGNUP_MAIL_CONFIG: JSON.stringify({
    subject: 'FROST signup',
    preheader: 'Your signup is saved.',
    title: 'Thanks <friend>',
    paragraphs: ['Line one\nLine two', '<script>unsafe</script> & text'],
    button: { text: 'Learn more', url: 'https://www.zknoir.com/frost?x=1&y=2' }
  })
}

function fixture(t, setup) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  setup?.(db)
  const sql = {
    exec(query, ...bindings) {
      const statement = db.prepare(query)
      const rows = statement.columns().length
        ? statement.all(...bindings)
        : (statement.run(...bindings), [])
      return {
        toArray: () => rows,
        one() {
          assert.equal(rows.length, 1)
          return rows[0]
        }
      }
    }
  }
  const transaction = callback => {
    db.exec('BEGIN')
    try {
      const value = callback()
      db.exec('COMMIT')
      return value
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return {
    db,
    store: new SignupStore(sql, transaction),
    reopen: () => new SignupStore(sql, transaction)
  }
}

function alarmStorage() {
  let alarm = null
  const scheduled = []
  return {
    scheduled,
    getAlarm: async () => alarm,
    setAlarm: async time => {
      alarm = time
      scheduled.push(time)
    },
    fire: () => {
      alarm = null
    }
  }
}

test('new signups queue one mail atomically; duplicates and historical signups do not enqueue', t => {
  const { store, db } = fixture(t)
  store.register('legacy@example.com', 100)
  store.registerWithMail('legacy@example.com', 200, 'legacy-job')
  store.registerWithMail('alice@example.com', 200, 'job-a')
  store.registerWithMail('alice@example.com', 300, 'job-b')
  assert.deepEqual(
    db
      .prepare('SELECT id,email,status FROM signup_mail')
      .all()
      .map(row => ({ ...row })),
    [{ id: 'job-a', email: 'alice@example.com', status: 'pending' }]
  )
  assert.equal(
    db.prepare('SELECT created_at FROM frost_signups WHERE email=?').get('alice@example.com')
      .created_at,
    200
  )
  assert.throws(() => store.registerWithMail('bob@example.com', 300, 'job-a'))
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM frost_signups WHERE email=?').get('bob@example.com').n,
    0
  )
})

test('concurrent delivery claims send only once, including after object restart', async t => {
  const { store, db, reopen } = fixture(t)
  store.registerWithMail('alice@example.com', 1, 'job-a')
  let sends = 0
  const send = async mail => {
    sends++
    assert.equal(mail.to, 'alice@example.com')
  }
  await Promise.all([
    deliverNextSignup(store, readMailSettings(secrets), send, () => 1000),
    deliverNextSignup(store, readMailSettings(secrets), send, () => 1000)
  ])
  await deliverNextSignup(reopen(), readMailSettings(secrets), send, () => 100000)
  assert.equal(sends, 1)
  assert.equal(db.prepare('SELECT status FROM signup_mail').get().status, 'sent')
})

test('temporary rejection retries with a bound and the alarm follows the next due time', async t => {
  const { store, db } = fixture(t)
  const alarms = alarmStorage()
  store.registerWithMail('alice@example.com', 1, 'job-a')
  await scheduleNextMail(store, alarms, () => 1000)
  assert.deepEqual(alarms.scheduled, [2000])
  let clock = 2000
  for (let i = 0; i < 3; i++) {
    alarms.fire()
    await deliverNextSignup(
      store,
      readMailSettings(secrets),
      async () => {
        throw { responseCode: 451, command: 'DATA' }
      },
      () => clock
    )
    const next = store.nextMailTime()
    if (i < 2) {
      assert.ok(next > clock)
      await scheduleNextMail(store, alarms, () => clock)
      assert.equal(alarms.scheduled.at(-1), next)
      clock = next
    }
  }
  assert.equal(store.nextMailTime(), null)
  assert.deepEqual(
    { ...db.prepare('SELECT status,attempts FROM signup_mail').get() },
    { status: 'failed', attempts: 3 }
  )
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM frost_signups').get().n, 1)
})

test('earlier pending work advances an existing alarm without postponing it', async t => {
  const { store } = fixture(t)
  const alarms = alarmStorage()
  store.registerWithMail('alice@example.com', 10000, 'job-a')
  await scheduleNextMail(store, alarms, () => 1000)
  store.registerWithMail('bob@example.com', 2000, 'job-b')
  await scheduleNextMail(store, alarms, () => 1000)
  await ensureMailAlarm(alarms, 20000)
  assert.deepEqual(alarms.scheduled, [10000, 2000])
})

test('permanent rejection and ambiguous timeout do not trigger automatic duplicate sends', async t => {
  for (const [error, expected] of [
    [{ responseCode: 550, command: 'RCPT TO' }, 'failed'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'unknown']
  ]) {
    const { store, db } = fixture(t)
    store.registerWithMail('alice@example.com', 1, 'job-a')
    await deliverNextSignup(
      store,
      readMailSettings(secrets),
      async () => {
        throw error
      },
      () => 1000
    )
    assert.equal(db.prepare('SELECT status FROM signup_mail').get().status, expected)
    assert.equal(store.claimMail(1000000), null)
  }
  assert.equal(deliveryOutcome({ code: 'ETIMEDOUT', command: 'CONN' }), 'unknown')
  for (const responseCode of [NaN, Infinity, 451.5, '451', 600]) {
    assert.equal(deliveryOutcome({ responseCode }), 'unknown')
  }
})

test('interrupted in-flight send is marked unknown on restart; later recipients stay paced', t => {
  const { store, db, reopen } = fixture(t)
  store.registerWithMail('alice@example.com', 1, 'job-a')
  store.registerWithMail('bob@example.com', 2, 'job-b')
  assert.equal(store.claimMail(1000).email, 'alice@example.com')
  assert.equal(store.claimMail(1000), null)
  assert.equal(reopen().claimMail(61000).email, 'bob@example.com')
  assert.equal(
    db.prepare("SELECT status FROM signup_mail WHERE id='job-a'").get().status,
    'unknown'
  )
})

test('schema upgrade preserves old mail rows and historical vote data', t => {
  const { db } = fixture(t, db => {
    db.exec('CREATE TABLE votes (voter_hash TEXT PRIMARY KEY)')
    db.exec("INSERT INTO votes VALUES ('legacy-voter')")
    db.exec(
      'CREATE TABLE signup_mail (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
    )
    db.exec("INSERT INTO signup_mail VALUES ('old-job','old@example.com','sending',1,100,100)")
  })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM votes').get().n, 1)
  assert.deepEqual(
    { ...db.prepare('SELECT status,attempts,error_code,error_stage FROM signup_mail').get() },
    { status: 'unknown', attempts: 1, error_code: 'WORKER_INTERRUPTED', error_stage: 'SEND' }
  )
})

test('missing or unsafe mail configuration fails closed and rendered mail escapes content', async () => {
  assert.throws(() => readMailSettings({}), /MAIL_CONFIGURATION_INVALID/)
  for (const change of [
    { SMTP_APP_PASSWORD: '' },
    { SMTP_USER: 'x\r\nBcc: hidden@example.com' },
    { SIGNUP_MAIL_CONFIG: '{}' },
    {
      SIGNUP_MAIL_CONFIG: JSON.stringify({ subject: 'x\r\nBcc: x', title: 'x', paragraphs: ['x'] })
    },
    {
      SIGNUP_MAIL_CONFIG: JSON.stringify({
        subject: 'x',
        title: 'x',
        paragraphs: ['x'],
        button: { text: 'x', url: 'javascript:alert(1)' }
      })
    }
  ])
    assert.throws(() => readMailSettings({ ...secrets, ...change }), /MAIL_CONFIGURATION_INVALID/)
  const mail = renderSignupMail(readMailSettings(secrets).template, 'alice@example.com', 'job-id')
  assert.ok(mail.html.includes('Thanks &lt;friend&gt;'))
  assert.ok(mail.html.includes('&lt;script&gt;unsafe&lt;/script&gt; &amp; text'))
  assert.ok(mail.html.includes('x=1&amp;y=2'))
  assert.ok(mail.text.includes('Line one\nLine two'))
  assert.throws(() =>
    renderSignupMail(readMailSettings(secrets).template, 'x\r\nBcc: hidden@example.com', 'id')
  )
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    disableFileAccess: true,
    disableUrlAccess: true
  })
  try {
    const result = await transport.sendMail(mail)
    const mime = result.message.toString('utf8')
    assert.match(mime, /Content-Type: multipart\/alternative/)
    assert.deepEqual(result.envelope.to, ['alice@example.com'])
  } finally {
    transport.close()
  }
})

test('mail errors retain safe diagnostic fields without exposing secrets', async t => {
  const { store, db } = fixture(t)
  store.registerWithMail('alice@example.com', 1, 'job-a')
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const error = Object.assign(new Error('alice@example.com password abcdefghijklmnop'), {
    code: 'EAUTH',
    command: 'AUTH PLAIN',
    responseCode: 535,
    response: 'private SMTP response alice@example.com'
  })
  await deliverNextSignup(
    store,
    readMailSettings(secrets),
    async () => {
      throw error
    },
    () => 1000
  )
  assert.deepEqual(
    {
      ...db
        .prepare('SELECT status,error_code,error_stage,smtp_code,error_name FROM signup_mail')
        .get()
    },
    {
      status: 'failed',
      error_code: 'EAUTH',
      error_stage: 'AUTH',
      smtp_code: 535,
      error_name: 'Error'
    }
  )
  const output = JSON.stringify([warnings, db.prepare('SELECT * FROM signup_mail').get()])
  assert.ok(!output.includes('abcdefghijklmnop'))
  assert.ok(!output.includes('private SMTP response'))
  assert.deepEqual(
    mailDiagnostic({
      code: 'private@example.com',
      command: 'RCPT TO:<private@example.com>',
      responseCode: '535'
    }),
    { code: 'MAIL_ERROR', stage: 'UNSPECIFIED', smtpCode: null, name: 'Error' }
  )
})

test('TLS setup verifies the Gmail host and releases listeners on success or timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const makeSocket = () => {
    const socket = new EventEmitter()
    socket.destroyed = false
    socket.destroy = () => {
      socket.destroyed = true
    }
    return socket
  }
  const connected = makeSocket()
  const opening = openGmailSocket(options => {
    assert.deepEqual(
      {
        host: options.host,
        port: options.port,
        servername: options.servername,
        rejectUnauthorized: options.rejectUnauthorized
      },
      { host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com', rejectUnauthorized: true }
    )
    return connected
  })
  connected.emit('secureConnect')
  assert.equal(await opening, connected)
  assert.equal(connected.listenerCount('error'), 0)
  assert.equal(connected.listenerCount('close'), 0)
  const stalled = makeSocket()
  const pending = openGmailSocket(() => stalled)
  const rejected = assert.rejects(pending, { code: 'ETIMEDOUT', command: 'CONN' })
  t.mock.timers.tick(10000)
  await rejected
  assert.equal(stalled.destroyed, true)
  assert.equal(stalled.listenerCount('secureConnect'), 0)
})
