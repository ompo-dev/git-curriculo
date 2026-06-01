import apiApp from "@gitcurriculo/api";

export const dynamic = "force-dynamic";

function toApiRequest(request: Request): Request {
  const incomingUrl = new URL(request.url);
  const pathname = incomingUrl.pathname.startsWith("/api")
    ? incomingUrl.pathname.slice(4) || "/"
    : incomingUrl.pathname;
  const targetUrl = new URL(incomingUrl.toString());
  targetUrl.pathname = pathname;
  return new Request(targetUrl.toString(), request);
}

async function handle(request: Request): Promise<Response> {
  return apiApp.handle(toApiRequest(request));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
