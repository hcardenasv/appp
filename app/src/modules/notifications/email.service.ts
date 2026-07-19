import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST', '');
    this.from    = config.get<string>('SMTP_FROM', 'APPP <noreply@appp.local>');
    this.enabled = !!host && host !== 'changeme';

    this.transporter = nodemailer.createTransport({
      host:   config.get<string>('SMTP_HOST',  'localhost'),
      port:   config.get<number>('SMTP_PORT',  587),
      secure: config.get<number>('SMTP_PORT',  587) === 465,
      auth: {
        user: config.get<string>('SMTP_USER', ''),
        pass: config.get<string>('SMTP_PASS', ''),
      },
    });
  }

  isConfigured(): boolean {
    return this.enabled;
  }

  isRealEmail(email: string): boolean {
    return !!email && !email.endsWith('@appp.local');
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    await this.sendHtml(to, subject, undefined, body);
  }

  async sendHtml(to: string, subject: string, html: string | undefined, text: string): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`Email deshabilitado (SMTP_HOST no configurado) — se omite: ${subject}`);
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, text });
      this.logger.log(`Email enviado a ${to}: ${subject}`);
    } catch (err) {
      this.logger.error(`Error enviando email a ${to}`, err);
      throw err;
    }
  }
}
