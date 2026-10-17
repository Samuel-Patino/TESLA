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
    const targetBadge = $('targetCodeBadge');
    if (targetBadge) {
      targetBadge.textContent = targetCode ? `Tesla: ${targetCode}` : "Sin vincular";
    }

    // Detección de iPhone / iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const iosAlert = $('iosAlertCard');
    const optSource = $('optSource');
    const senderSubtitle = $('senderSubtitle');

    if (isIOS) {
      if (iosAlert) iosAlert.hidden = false;
      if (optSource) optSource.value = 'camera-back';
      if (senderSubtitle) {
        senderSubtitle.textContent = 'En iPhone transmite tu cámara en vivo con audio hacia el Tesla.';
      }
    }

    let localPeer = null;
    let localStream = null;
    let activeCall = null;
    let timerInterval = 0;
    let startTime = 0;

    const btnStart = $('btnStartShare');
    const btnStartTxt = $('btnStartTxt');
    const senderPreview = $('senderPreview');
    const broadcastStatus = $('broadcastStatus');
    const shareTimeEl = $('shareTimer');

    function updateBtnLabel() {
      if (!btnStartTxt) return;
      if (localStream) {
        btnStartTxt.textContent = 'Detener Transmisión';
      } else {
        const src = optSource ? optSource.value : 'screen';
        btnStartTxt.textContent = src === 'screen' ? 'Iniciar Transmisión de Pantalla' : 'Iniciar Transmisión de Cámara';
      }
    }

    if (optSource) {
      optSource.onchange = () => {
        updateBtnLabel();
      };
      updateBtnLabel();
    }

    // Inicializar peer del celular
    try {
      localPeer = new Peer(null, { debug: 1 });

      localPeer.on('open', id => {
        if (statusDot) statusDot.className = 'dot ok';
        if (statusTxt) statusTxt.textContent = 'Listo para transmitir';
      });

      localPeer.on('error', err => {
        console.warn('Error Peer Celular:', err);
        toast('Error de conexión: ' + (err.message || 'Intenta de nuevo'));
      });
    } catch (e) {
      console.warn('Error al crear localPeer:', e);
    }

    btnStart.onclick = async () => {
      if (localStream) {
        stopBroadcasting();
        return;
      }

      if (!targetCode) {
        toast('Falta el código de la pantalla del Tesla');
        return;
      }

      const source = optSource ? optSource.value : 'screen';
      const quality = $('optQuality').value;
      const shareAudio = $('optAudio').checked;

      let width = 1920, height = 1080, fps = 60;
      if (quality === '720') { width = 1280; height = 720; fps = 30; }
      else if (quality === '480') { width = 854; height = 480; fps = 30; }

      try {
        if (source === 'screen') {
          statusTxt.textContent = 'Solicitando pantalla…';

          if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            throw new Error(isIOS
              ? 'Apple iOS no permite captura de pantalla desde páginas web. Selecciona "Cámara Trasera" o transmite desde Android / PC.'
              : 'Este navegador móvil no soporta captura de pantalla directa.');
          }

          try {
            localStream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                width: { ideal: width },
                height: { ideal: height },
                frameRate: { ideal: fps, max: fps }
              },
              audio: shareAudio ? { echoCancellation: false, noiseSuppression: false } : false
            });
          } catch (e1) {
            console.warn('Reintentando con constraints simples de pantalla:', e1);
            localStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          }

        } else {
          // MODO CÁMARA (100% COMPATIBLE CON IPHONE iOS Y ANDROID)
          statusTxt.textContent = 'Iniciando cámara…';
          const facing = source === 'camera-front' ? 'user' : { ideal: 'environment' };

          localStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: facing,
              width: { ideal: width },
              height: { ideal: height },
              frameRate: { ideal: fps, max: fps }
            },
            audio: shareAudio
          });
        }

        // Vista previa local
        senderPreview.srcObject = localStream;
        senderPreview.hidden = false;

        // Si el usuario detiene la captura desde la barra del sistema
        const track = localStream.getVideoTracks()[0];
        if (track) {
          track.onended = () => {
            stopBroadcasting();
          };
        }

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
        btnStart.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> <span id="btnStartTxt">Detener Transmisión</span>`;
        statusDot.className = 'dot live';
        statusTxt.textContent = 'Transmitiendo en vivo';
        toast(source === 'screen' ? 'Transmitiendo pantalla al Tesla' : 'Transmitiendo cámara al Tesla');

      } catch (err) {
        console.error('Error al capturar fuente:', err);
        statusTxt.textContent = 'Transmisión cancelada';
        toast((err.message || 'Permiso denegado'), 5000);
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
      const src = optSource ? optSource.value : 'screen';
      const label = src === 'screen' ? 'Iniciar Transmisión de Pantalla' : 'Iniciar Transmisión de Cámara';
      btnStart.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg> <span id="btnStartTxt">${label}</span>`;
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
  let shareUrl = '';
  try {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('role', 'sender');
    currentUrl.searchParams.set('code', roomCode);
    shareUrl = currentUrl.toString();
  } catch (e) {
    const base = window.location.href.split('?')[0];
    shareUrl = `${base}?role=sender&code=${encodeURIComponent(roomCode)}`;
  }

  // Generar Código QR (con fallback si falla la librería o canvas)
  const qrTarget = $('qrcode');
  function renderQR() {
    if (!qrTarget) return;
    qrTarget.innerHTML = '';

    let success = false;
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(qrTarget, {
          text: shareUrl,
          width: 220,
          height: 220,
          colorDark: "#05070d",
          colorLight: "#ffffff",
          correctLevel: (QRCode.CorrectLevel && QRCode.CorrectLevel.M !== undefined) ? QRCode.CorrectLevel.M : 0
        });
        success = true;
      } catch (err) {
        console.warn('Fallo renderizado nativo QRCode:', err);
      }
    }

    if (!success) {
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shareUrl)}&bgcolor=ffffff&color=05070d&margin=4`;
      img.alt = `Código QR Sala ${roomCode}`;
      img.width = 220;
      img.height = 220;
      img.style.display = 'block';
      img.onerror = () => {
        qrTarget.innerHTML = `
          <div style="padding: 16px; text-align: center; color: #111;">
            <div style="font-size: 12px; font-weight: 800; color: #64748b; letter-spacing: 0.05em;">CÓDIGO DE SALA</div>
            <div style="font-size: 30px; font-weight: 900; letter-spacing: 0.12em; color: #7e22ce; margin: 6px 0;">${roomCode}</div>
            <div style="font-size: 11px; color: #475569; line-height: 1.3;">Abre esta página en tu celular y toca Transmitir</div>
          </div>
        `;
      };
      qrTarget.appendChild(img);
    }
  }

  renderQR();

  // Copiar enlace seguro (compatible con HTTP y navegadores de auto)
  const btnCopy = $('btnCopyLink');
  if (btnCopy) {
    btnCopy.onclick = () => {
      copyToClipboard(shareUrl);
    };
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        toast('Enlace copiado al portapapeles');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        toast('Enlace copiado al portapapeles');
        return;
      }
    } catch (_) {}
    prompt('Copia este enlace para tu celular:', text);
  }

  // Inicializar PeerJS como Receptor
  let peer = null;
  const peerId = 'velox-' + roomCode.toLowerCase();

  try {
    peer = new Peer(peerId, { debug: 1 });

    peer.on('open', id => {
      if (statusDot) statusDot.className = 'dot ok';
      if (statusTxt) statusTxt.textContent = 'Listo para conectar';
    });

    peer.on('call', call => {
      if (statusTxt) statusTxt.textContent = 'Recibiendo video…';
      if (statusDot) statusDot.className = 'dot live';

      call.answer(); // Responde sin enviar stream de vuelta

      call.on('stream', remoteStream => {
        if (pairingView) pairingView.hidden = true;
        if (streamContainer) streamContainer.hidden = false;
        if (teslaVideo) {
          teslaVideo.srcObject = remoteStream;
          teslaVideo.play().catch(e => console.warn('Autoplay prevenido:', e));
        }

        if (statusTxt) statusTxt.textContent = 'En vivo';
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
        roomCode = genCode();
        if (roomCodeEl) roomCodeEl.textContent = roomCode;
        try {
          const u = new URL(window.location.href);
          u.searchParams.set('role', 'sender');
          u.searchParams.set('code', roomCode);
          shareUrl = u.toString();
        } catch (_) {}
        renderQR();
        peer = new Peer('velox-' + roomCode.toLowerCase(), { debug: 1 });
      } else {
        if (statusTxt && statusTxt.textContent === 'Conectando…') {
          statusTxt.textContent = 'Listo para conectar';
        }
      }
    });

  } catch (e) {
    console.error('Error inicializando PeerJS:', e);
    if (statusTxt) statusTxt.textContent = 'Listo para conectar';
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
