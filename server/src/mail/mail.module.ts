import { Global, Module } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { mailConfig } from './mail.config';
import { MAIL_TRANSPORT, MailService, type MailTransport } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      useFactory: (): MailTransport => {
        const cfg = mailConfig();
        if (!cfg.enabled) return { sendMail: () => Promise.reject(new Error('Почта не настроена (SMTP_HOST)')) };
        return nodemailer.createTransport({
          host: cfg.host, port: cfg.port, secure: cfg.secure,
          auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
          disableFileAccess: true, disableUrlAccess: true, // письма — только текст, без вложений по путям и ссылкам
        });
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
