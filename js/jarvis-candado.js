"use strict";

// Enlace de JARVIS cifrado con su contraseña. Se regenera con un script fuera del repo.
(function (raiz) {
  const CANDADO_JARVIS = Object.freeze({
    "iteraciones": 600000,
    "sal": "nI/wlg3Aw0BQD5zHE4vSzw==",
    "iv": "axQx0+3y1BGf4zCu",
    "datos": "Cm4BI87z1mHU5do+0tfLqNRYemUIYBdYT9QBlvdHt1Uk6pYt2lSdte6PqFATI92k3JnwufPoYCIgmIVSOw=="
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = { CANDADO_JARVIS };
  else raiz.CANDADO_JARVIS = CANDADO_JARVIS;
})(typeof window !== 'undefined' ? window : globalThis);
