import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../env';
export const pageRoutes = new Hono<AppEnv>();
export async function renderErrorPage(_c: Ctx, status: number, message: string): Promise<string> { return `<h1>${status}</h1><p>${message}</p>`; }
