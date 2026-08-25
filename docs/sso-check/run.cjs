// Faux navigateur : un magasin de cookies qui applique la limite réelle.
const jar = new Map();
const LIMIT = 4096;
globalThis.window = { location: { hostname: "app.morada.lu", protocol: "https:" }, localStorage: {
  _m: new Map(),
  getItem(k){ return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k,v){ this._m.set(k,v); },
  removeItem(k){ this._m.delete(k); },
}};
globalThis.document = {
  get cookie(){ return [...jar].map(([k,v]) => `${k}=${v}`).join("; "); },
  set cookie(str){
    if (str.length > LIMIT) throw new Error("cookie trop gros: " + str.length);
    const [pair, ...attrs] = str.split("; ");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq), value = pair.slice(eq + 1);
    const maxAge = attrs.find(a => a.startsWith("max-age="));
    if (maxAge && maxAge.slice(8) === "0") jar.delete(name); else jar.set(name, value);
    const dom = attrs.find(a => a.startsWith("domain="));
    if (dom !== "domain=.morada.lu") throw new Error("mauvais domaine: " + dom);
  },
};

const { createCookieStorage } = require("./out/sessionCookie.js");
const s = createCookieStorage({ mirrorToLocalStorage: true });
const KEY = "morada_auth";
let fail = 0;
const check = (label, cond) => { console.log((cond ? "  ok   " : "  FAIL ") + label); if (!cond) fail++; };

// 1. vide au départ
check("aucune session au départ", s.getItem(KEY) === null);

// 2. petite session
s.setItem(KEY, '{"access_token":"court"}');
check("petite session relue à l'identique", s.getItem(KEY) === '{"access_token":"court"}');
check("une seule entrée de cookie", jar.size === 1);

// 3. grosse session réaliste (JWT ~1.5 ko + refresh + user)
const big = JSON.stringify({ access_token: "e" + "y".repeat(1800), refresh_token: "r".repeat(60),
  user: { id: "8b2c", email: "jean@example.lu", meta: "é".repeat(400) } });
s.setItem(KEY, big);
check("grosse session (" + big.length + " car.) relue à l'identique", s.getItem(KEY) === big);
check("découpée en plusieurs cookies", jar.size > 1);
check("aucun cookie au-dessus de la limite", [...jar].every(([k,v]) => (k+"="+v).length < 4000));

// 4. repasser à une petite session ne laisse pas de morceaux orphelins
s.setItem(KEY, '{"a":1}');
check("les morceaux précédents sont effacés", jar.size === 1 && s.getItem(KEY) === '{"a":1}');

// 5. déconnexion
s.removeItem(KEY);
check("déconnexion : plus aucun cookie", jar.size === 0 && s.getItem(KEY) === null);
check("déconnexion : localStorage vidé aussi", window.localStorage.getItem(KEY) === null);

// 6. adoption d'une session localStorage existante (personne n'est déconnecté)
window.localStorage.setItem(KEY, big);
const adopted = s.getItem(KEY);
check("session localStorage adoptée", adopted === big);
check("et promue en cookie partagé", jar.size > 0);

console.log(fail === 0 ? "\nTOUT PASSE" : `\n${fail} ECHEC(S)`);
process.exit(fail === 0 ? 0 : 1);
