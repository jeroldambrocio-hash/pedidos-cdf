// Public Supabase settings (the anon key is meant to be public; access is enforced by row-level security).
window.CDF_CONFIG = {
  url: "https://nskbtxagdkvkxqneoucv.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5za2J0eGFnZGt2a3hxbmVvdWN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTY0MjIsImV4cCI6MjEwNjE3MjQyMn0.8soG3emEPEQhiUhGMTrpnYrtE7pIakLEDESekQfMQwM",
  bucket: "cdf-fotos",
  // Public half of the web-push key pair (the private half lives only in Supabase, secret CDF_VAPID_KEYS)
  vapidPublicKey: "BGIPCcDIYIJshzork6qA-J29exASHwFxK_DCLUEAuJgKLw-1rmdJwEPX0gLQNS76px1pkNs6YhoPzlUNz5wuZsM",
  // "Enviar sugerencia" opens the person's email app addressed here
  feedbackTo: "jerold.ambrocio@gmail.com",
  // Features switched off for now, kept for later. Change to true to bring them back (the code is all still there).
  // tracking: customer tracking link (/p/…) in the order, the WhatsApp/copied messages and the tracking page.
  //   The emails follow the Supabase secret CDF_TRACKING=on in cdf-notify.
  // drivers: the Driver role, the Driver field on orders, and sign-in for driver accounts.
  //   Creating drivers follows the Supabase secret CDF_DRIVERS=on in cdf-users.
  // orderChats: each order's own conversation (all admins + the florist of that order).
  // directChats: private chats between two people. The team channel always stays.
  // publicOrder: the public order form (/pedido.html). Off: the page only says it is not open yet and
  // never calls the server. The server has its own switch too (secret PUBLIC_ORDER=on in cdf-public-order).
  features: { tracking: false, drivers: false, orderChats: true, directChats: false, publicOrder: false },
  // Public order form. turnstileSiteKey: Cloudflare Turnstile's public site key (its secret goes in the
  // function as TURNSTILE_SECRET). The form does not work without it once the server asks for the check.
  // googleMapsKey: a Google Maps *browser* key for the form's map and address suggestions. It is public by
  // nature, so in Google Cloud restrict it to this site (HTTP referrer) and to "Maps JavaScript API" and
  // "Places API (New)", and set a daily quota on both: that quota is what keeps it inside the free allowance.
  // It is NOT the server key (GOOGLE_MAPS_KEY); never put that one here. Empty: the form uses the free map.
  // The key below is restricted to https://casadeflores-store.netlify.app/* : a page on any other address
  // (another domain, localhost) is refused by Google and the form falls back to the free map.
  // googleMapId: optional Map ID (lets the map use Google's newer marker and a custom style).
  publicOrder: { turnstileSiteKey: "0x4AAAAAAF9OGTKdi942pJhQ", googleMapsKey: "AIzaSyCYm44Fhn9zxmo246vvJEuR0sIK1F_gI0A", googleMapId: "" },
};
