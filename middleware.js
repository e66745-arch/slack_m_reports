export const config = {
  matcher: "/api/:path*",  // API のみ対象
};

export function middleware(req) {
  return new Response(req.body, {
    headers: req.headers,
  });
}
