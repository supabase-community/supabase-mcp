// Shim to get PGlite to work in Vercel Edge Runtime
window.location = {
  pathname: '/',
} as string & Location;
