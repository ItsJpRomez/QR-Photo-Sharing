import { ZodError } from 'zod'
import { AppError, errorMessage, type ErrorCode } from './errors'

type Params = Record<string, string | string[]>
export type RouteContext<P extends Params = Params> = { params: Promise<P> }
export type RouteHandler<P extends Params = Params> = (req: Request, ctx: RouteContext<P>) => Promise<Response>

function errorResponse(code: ErrorCode, status: number, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

/** Wraps a handler so every failure has the same safe shape. */
export function route<P extends Params = Params>(fn: RouteHandler<P>): RouteHandler<P> {
  return async (req, ctx) => {
    let res: Response
    try {
      res = await fn(req, ctx)
    } catch (err) {
      if (err instanceof AppError) res = errorResponse(err.code, err.status, err.message)
      else if (err instanceof ZodError || (err instanceof SyntaxError && req.method !== 'GET'))
        res = errorResponse('bad_input', 400, errorMessage('bad_input'))
      else {
        console.error(`${req.method} ${new URL(req.url).pathname} failed`, err)
        res = errorResponse('internal', 500, errorMessage('internal'))
      }
    }
    if (!res.headers.has('cache-control')) res.headers.set('cache-control', 'no-store')
    return res
  }
}
