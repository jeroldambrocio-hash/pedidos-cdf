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
  // chats: the conversation inside each order and private chats between people (the team channel always stays).
  features: { tracking: false, drivers: false, chats: false },
};
