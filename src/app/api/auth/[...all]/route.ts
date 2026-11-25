import { getAuth } from '@/auth/server'

const handler = (req: Request) => getAuth().handler(req)

export { handler as GET, handler as POST }
