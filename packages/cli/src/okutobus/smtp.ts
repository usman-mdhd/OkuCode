// Okutobus (OkuCode): sends one email over SMTP with TLS (Gmail: smtp.gmail.com:465 with an app password).
// No extra packages: a small SMTP conversation over node:tls.
import { connect, type TLSSocket } from "node:tls"

export type Mail = {
  host: string
  port: number
  user: string
  pass: string
  from: string
  fromName?: string
  to: string
  subject: string
  text: string
  html: string
  /** Tests only: accept a self-signed certificate. */
  insecure?: boolean
  timeoutMs?: number
}

const wrap = (value: string) => value.replace(/.{1,76}/g, "$&\r\n").trimEnd()
const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64")
const header = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`)

export function message(mail: Mail, boundary = `okucode-${Date.now().toString(36)}`) {
  const from = mail.fromName ? `${header(mail.fromName)} <${mail.from}>` : mail.from
  return [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@okucode>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(mail.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(mail.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n")
}

class Conversation {
  private buffer = ""
  private waiting: ((line: { code: number; text: string } | Error) => void) | undefined
  private replies: ({ code: number; text: string } | Error)[] = []
  private lines: string[] = []

  constructor(readonly socket: TLSSocket) {
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      this.buffer += chunk
      let index: number
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).replace(/\r$/, "")
        this.buffer = this.buffer.slice(index + 1)
        this.lines.push(line)
        // "250-..." continues a reply, "250 ..." ends it.
        if (/^\d{3}(?: |$)/.test(line)) {
          this.push({ code: Number(line.slice(0, 3)), text: this.lines.join("\n") })
          this.lines = []
        }
      }
    })
    socket.on("error", (error) => this.push(error))
    socket.on("close", () => this.push(new Error("The mail server closed the connection.")))
  }

  private push(reply: { code: number; text: string } | Error) {
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = undefined
      resolve(reply)
    } else this.replies.push(reply)
  }

  reply(): Promise<{ code: number; text: string }> {
    const next = this.replies.shift()
    const settle = (value: { code: number; text: string } | Error) =>
      value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
    if (next) return settle(next)
    return new Promise((resolve, reject) => {
      this.waiting = (value) => (value instanceof Error ? reject(value) : resolve(value))
    })
  }

  async expect(codes: number[], command?: string, label = command) {
    if (command !== undefined) this.socket.write(`${command}\r\n`)
    const reply = await this.reply()
    if (!codes.includes(reply.code)) {
      const what = label?.startsWith("AUTH") || label === undefined ? "sign-in" : label.split(" ")[0]
      throw new Error(
        reply.code === 535
          ? "Gmail rejected the address or app password. Check them in the admin panel's Setup tab."
          : `The mail server refused ${what}: ${reply.text.split("\n").pop()}`,
      )
    }
    return reply
  }
}

export async function send(mail: Mail) {
  const ip = /^[\d.]+$|:/.test(mail.host)
  const socket = connect({
    host: mail.host,
    port: mail.port,
    ...(ip ? {} : { servername: mail.host }),
    rejectUnauthorized: !mail.insecure,
  })
  const timer = setTimeout(() => socket.destroy(new Error("The mail server did not answer in time.")), mail.timeoutMs ?? 20_000)
  const chat = new Conversation(socket)
  try {
    await chat.expect([220])
    await chat.expect([250], "EHLO okucode")
    await chat.expect([334], "AUTH LOGIN")
    await chat.expect([334], b64(mail.user), "AUTH user")
    await chat.expect([235], b64(mail.pass), "AUTH password")
    await chat.expect([250], `MAIL FROM:<${mail.from}>`)
    await chat.expect([250, 251], `RCPT TO:<${mail.to}>`)
    await chat.expect([354], "DATA")
    // Lines starting with "." are doubled so they are not read as the end of the message.
    const body = message(mail).replace(/\r\n\./g, "\r\n..")
    await chat.expect([250], `${body}\r\n.`, "message")
    socket.write("QUIT\r\n")
  } finally {
    clearTimeout(timer)
    socket.end()
  }
}
