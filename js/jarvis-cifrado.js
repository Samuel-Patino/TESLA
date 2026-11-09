"use strict";

/* =====================================================================
   Cifrado del enlace de JARVIS
   El enlace va cifrado con AES-GCM y una clave derivada de la contraseña
   (PBKDF2-SHA256). Ni la contraseña ni el enlace quedan escritos en el
   código: solo se recuperan si se escribe la contraseña correcta.
   ===================================================================== */
(function (raiz) {
  const codificador = new TextEncoder();
  const decodificador = new TextDecoder();

  const aBase64 = bytes => btoa(String.fromCharCode(...bytes));
  const deBase64 = texto => Uint8Array.from(atob(texto), letra => letra.charCodeAt(0));

  async function derivarClave(clave, sal, iteraciones, usos) {
    const base = await crypto.subtle.importKey('raw', codificador.encode(clave), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      usos
    );
  }

  async function cifrar(texto, clave, iteraciones) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const llave = await derivarClave(clave, sal, iteraciones, ['encrypt']);
    const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, codificador.encode(texto));
    return Object.freeze({ iteraciones, sal: aBase64(sal), iv: aBase64(iv), datos: aBase64(new Uint8Array(datos)) });
  }

  // Lanza un error si la clave no es la correcta.
  async function descifrar(candado, clave) {
    const llave = await derivarClave(clave, deBase64(candado.sal), candado.iteraciones, ['decrypt']);
    const datos = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(candado.iv) }, llave, deBase64(candado.datos));
    return decodificador.decode(datos);
  }

  const api = Object.freeze({ cifrar, descifrar });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.JarvisCifrado = api;
})(typeof window !== 'undefined' ? window : globalThis);
