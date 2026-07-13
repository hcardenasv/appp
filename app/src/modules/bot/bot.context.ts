import { Context } from 'grammy';
import type { User } from '@prisma/client';

export type AppContext = Context & {
  appUser?: User;
};
