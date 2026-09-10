import type { TelegramService } from "./telegram.service";

export type TelegramMessage = {
  chatId: string;
  messageId: string;
  fromId: number;
  text: string;
};

declare module "fastify" {
  interface FastifyInstance {
    telegramService: TelegramService;
  }
}