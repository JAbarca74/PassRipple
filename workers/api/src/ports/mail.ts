// Outgoing email behind a port (rule R5): the routes know a MailSender, not a provider.
// Amazon SES in production; a console sender for local development that refuses to run
// anywhere but localhost, so a misconfigured deployment cannot leak sign-in codes to logs.

import { AwsClient } from "aws4fetch";
import { type Env, required } from "../env.ts";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Prints messages instead of sending them. Local development only. */
export function consoleMailSender(requestUrl: string): MailSender {
  return {
    async send(message) {
      if (!LOCAL_HOSTS.has(new URL(requestUrl).hostname)) {
        throw new Error("the console mail sender only runs on localhost");
      }
      console.log(`[mail] to ${message.to}: ${message.subject}\n${message.text}`);
    },
  };
}

/** Amazon SES, API v2, signed with SigV4. */
export function sesMailSender(env: Env): MailSender {
  const region = required(env, "SES_REGION");
  const client = new AwsClient({
    accessKeyId: required(env, "SES_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "SES_SECRET_ACCESS_KEY"),
    region,
    service: "ses",
  });
  const fromAddress = required(env, "MAIL_FROM_ADDRESS");
  const from = env.MAIL_FROM_NAME ? `${env.MAIL_FROM_NAME} <${fromAddress}>` : fromAddress;
  return {
    async send(message) {
      const response = await client.fetch(
        `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            FromEmailAddress: from,
            Destination: { ToAddresses: [message.to] },
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: "UTF-8" },
                Body: { Text: { Data: message.text, Charset: "UTF-8" } },
              },
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`SES answered ${response.status}: ${await response.text()}`);
      }
    },
  };
}

export function createMailSender(env: Env, requestUrl: string): MailSender {
  switch (env.MAIL_PROVIDER) {
    case "ses":
      return sesMailSender(env);
    case "log":
      return consoleMailSender(requestUrl);
    default:
      throw new Error("MAIL_PROVIDER must be ses or log");
  }
}
