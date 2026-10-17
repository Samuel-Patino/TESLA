"use strict";

(function() {
  const $ = id => document.getElementById(id);

  // Elementos
  const pairingView = $('pairingView');
  const streamContainer = $('streamContainer');
  const senderView = $('senderView');
  const teslaVideo = $('teslaVideo');
  const roomCodeEl = $('roomCodeVal');
  const statusTxt = $('statusTxt');
  const statusDot = $('statusDot');
  const clockEl = $('clock');
  const streamOverlay = $('streamOverlay');
  const liveHud = $('liveHud');

  // Parámetros URL
  const urlParams = new URLSearchParams(window.location.search);
  const role = urlParams.get('role'); // 'sender' | null
  const codeParam = (urlParams.get('code') || '').trim();

  // Reloj
  function updateClock() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    if (clockEl) clockEl.textContent = `${h}:${m}`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Toast
  let toastTimer = 0;
  function toast(msg, ms = 3000) {
    let t = $('toastMsg');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toastMsg';
      t.className = 'toast-msg';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // Generador de código aleatorio
  function genCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let res = '';
    for (let i = 0; i < 4; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'TSLA-' + res;
  }

  /* =========================================================================
     MODO TRANSMISOR (CELULAR / MOBILE SENDER)
     ========================================================================= */
  if (role === 'sender') {
    document.title = "Transmitir al Tesla - VELOX";
    if (pairingView) pairingView.hidden = true;
    if (streamContainer) streamContainer.hidden = true;
    if (senderView) senderView.hidden = false;

    const targetCode = codeParam || prompt("Ingresa el código que aparece en la pantalla del Tesla:") || "";
    $('targetCodeBadge').textContent = targetCode ? `Tesla: ${targetCode}` : "Sin vincular";

    let localPeer = null;
    let localStream = null;
    let activeCall = null;
    let timerInterval = 0;
    let startTime = 0;

    const btnStart = $('btnStartShare');
    const senderPreview = $('senderPreview');
    const broadcastStatus = $('broadcastStatus');
    const shareTimeEl = $('shareTimer');

    // Inicializar peer del celular
    localPeer = new Peer(null, { debug: 1 });

    localPeer.on('open', id => {
      statusDot.className = 'dot ok';
      statusTxt.textContent = 'Listo para transmitir';
    });

    localPeer.on('error', err => {
      console.warn('Error Peer Celular:', err);
      toast('Error de conexión: ' + (err.message || 'Intenta de nuevo'));
    });

    btnStart.onclick = async () => {
      if (localStream) {
        stopBroadcasting();
        return;
      }

      if (!targetCode) {
        toast('Falta el código de la pantalla del Tesla');
        return;
      }

      const quality = $('optQuality').value;
      const shareAudio = $('optAudio').checked;

      let width = 1920, height = 1080, fps = 60;
      if (quality === '720') { width = 1280; height = 720; fps = 30; }
      else if (quality === '480') { width = 854; height = 480; fps = 30; }

      try {
        statusTxt.textContent = 'Solicitando pantalla…';

        // Captura de pantalla nativa
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          throw new Error('Este navegador móvil no soporta captura de pantalla directa.');
        }

        localStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: fps, max: fps },
            cursor: "always"
          },
          audio: shareAudio ? { echoCancellation: false, noiseSuppression: false } : false
        });

        // Vista previa local
        senderPreview.srcObject = localStream;
        senderPreview.hidden = false;

        // Detectar si el usuario detiene la transmisión desde la barra del sistema
        localStream.getVideoTracks()[0].onended = () => {
          stopBroadcasting();
        };

        statusTxt.textContent = 'Conectando con Tesla…';
        const targetPeerId = 'velox-' + targetCode.toLowerCase();
        activeCall = localPeer.call(targetPeerId, localStream);

        activeCall.on('close', () => {
          stopBroadcasting();
        });

        // UI Transmitiendo
        startTime = Date.now();
        timerInterval = setInterval(() => {
          const s = Math.floor((Date.now() - startTime) / 1000);
          const mins = String(Math.floor(s / 60)).padStart(2, '0');
          const secs = String(s % 60).padStart(2, '0');
          shareTimeEl.textContent = `${mins}:${secs}`;
        }, 1000);

        broadcastStatus.hidden = false;
        btnStart.classList.add('stopping');
        btnStart.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener Transmisión`;
        statusDot.className = 'dot live';
        statusTxt.textContent = 'Transmitiendo en vivo';
        toast('Transmitiendo pantalla al Tesla');

      } catch (err) {
        console.error('Error al capturar pantalla:', err);
        statusTxt.textContent = 'Transmisión cancelada';
        toast('No se inició la transmisión: ' + (err.message || 'Permiso denegado'));
        stopBroadcasting();
      }
    };

    function stopBroadcasting() {
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      if (activeCall) {
        activeCall.close();
        activeCall = null;
      }
      clearInterval(timerInterval);
      if (broadcastStatus) broadcastStatus.hidden = true;
      if (senderPreview) {
        senderPreview.hidden = true;
        senderPreview.srcObject = null;
      }
      btnStart.classList.remove('stopping');
      btnStart.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg> Iniciar Transmisión de Pantalla`;
      statusDot.className = 'dot ok';
      statusTxt.textContent = 'Conexión lista';
    }

    return; // Fin de modo sender
  }

  /* =========================================================================
     MODO RECEPTOR (PANTALLA TESLA)
     ========================================================================= */
  let roomCode = genCode();
  if (roomCodeEl) roomCodeEl.textContent = roomCode;

  // Generar URL completa para el celular
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('role', 'sender');
  currentUrl.searchParams.set('code', roomCode);
  const shareUrl = currentUrl.toString();

  // Generar Código QR
  const qrTarget = $('qrcode');
  if (qrTarget && typeof QRCode !== 'undefined') {
    new QRCode(qrTarget, {
      text: shareUrl,
      width: 220,
      height: 220,
      colorDark: "#05070d",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  // Copiar enlace
  $('btnCopyLink').onclick = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      toast('Enlace copiado al portapapeles');
    }).catch(() => {
      prompt('Copia este enlace en tu celular:', shareUrl);
    });
  };

  // Inicializar PeerJS como Receptor
  let peer = null;
  const peerId = 'velox-' + roomCode.toLowerCase();

  try {
    peer = new Peer(peerId, { debug: 1 });

    peer.on('open', id => {
      statusDot.className = 'dot ok';
      statusTxt.textContent = 'Listo para conectar';
    });

    peer.on('call', call => {
      statusTxt.textContent = 'Recibiendo video…';
      statusDot.className = 'dot live';

      call.answer(); // Responde sin enviar stream de vuelta

      call.on('stream', remoteStream => {
        pairingView.hidden = true;
        streamContainer.hidden = false;
        teslaVideo.srcObject = remoteStream;
        teslaVideo.play().catch(() => {});

        statusTxt.textContent = 'En vivo';
        toast('Pantalla conectada exitosamente');
      });

      call.on('close', () => {
        onStreamClosed();
      });

      call.on('error', err => {
        console.warn('Error en llamada WebRTC:', err);
        onStreamClosed();
      });
    });

    peer.on('error', err => {
      console.warn('Peer error en Tesla:', err);
      if (err.type === 'unavailable-id') {
        // Regenerar si ya existía ese ID
        roomCode = genCode();
        if (roomCodeEl) roomCodeEl.textContent = roomCode;
        peer = new Peer('velox-' + roomCode.toLowerCase(), { debug: 1 });
      }
    });

  } catch (e) {
    console.error('Error inicializando PeerJS:', e);
  }

  function onStreamClosed() {
    if (teslaVideo) {
      teslaVideo.pause();
      teslaVideo.srcObject = null;
    }
    streamContainer.hidden = true;
    pairingView.hidden = false;
    statusDot.className = 'dot ok';
    statusTxt.textContent = 'Esperando conexión';
    toast('Transmisión finalizada');
  }

  /* ----------------------------------------------------
     Controles de Pantalla del Tesla
     ---------------------------------------------------- */
  // 1. Pantalla Completa
  $('btnFullscreen').onclick = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  $('ctrlFullscreen').onclick = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // 2. Ajuste de Aspecto (Contain vs Cover)
  let fitMode = 'contain';
  $('ctrlFit').onclick = () => {
    fitMode = fitMode === 'contain' ? 'cover' : 'contain';
    teslaVideo.style.objectFit = fitMode;
    $('ctrlFitTxt').textContent = fitMode === 'contain' ? 'Ajustar' : 'Rellenar';
    toast(fitMode === 'contain' ? 'Modo: Ajustar al encuadre' : 'Modo: Rellenar pantalla');
  };

  // 3. Rotación (0°, 90°, 180°, 270°)
  let rotDeg = 0;
  $('ctrlRotate').onclick = () => {
    rotDeg = (rotDeg + 90) % 360;
    teslaVideo.style.transform = `rotate(${rotDeg}deg)`;
    $('ctrlRotateTxt').textContent = `${rotDeg}°`;
    toast(`Rotación: ${rotDeg}°`);
  };

  // 4. Modo Noche / Atenuación de brillo
  let dimLevel = 1;
  $('ctrlDim').onclick = () => {
    dimLevel = dimLevel === 1 ? 0.75 : dimLevel === 0.75 ? 0.5 : 1;
    teslaVideo.style.filter = `brightness(${dimLevel})`;
    $('ctrlDimTxt').textContent = dimLevel === 1 ? 'Brillo 100%' : `Brillo ${Math.round(dimLevel * 100)}%`;
  };

  // 5. Audio / Silencio
  let isMuted = false;
  $('ctrlAudio').onclick = () => {
    isMuted = !isMuted;
    teslaVideo.muted = isMuted;
    $('ctrlAudioTxt').textContent = isMuted ? 'Silenciado' : 'Audio';
    toast(isMuted ? 'Audio del video silenciado' : 'Audio del video activado');
  };

  // 6. Desconectar
  $('ctrlDisconnect').onclick = () => {
    onStreamClosed();
  };

  // Auto-ocultar barra de controles tras 4 segundos de inactividad
  let idleTimer = 0;
  function resetIdle() {
    if (!streamContainer.hidden && streamOverlay) {
      streamOverlay.classList.remove('idle-hidden');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        streamOverlay.classList.add('idle-hidden');
      }, 4500);
    }
  }
  window.addEventListener('pointermove', resetIdle, { passive: true });
  window.addEventListener('touchstart', resetIdle, { passive: true });
  window.addEventListener('click', resetIdle, { passive: true });

})();
