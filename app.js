const els = {
  introCard: document.getElementById('introCard'),
  startButton: document.getElementById('startButton'),
  demoButton: document.getElementById('demoButton'),
  engineStatus: document.getElementById('engineStatus'),
  listeningPanel: document.getElementById('listeningPanel'),
  listeningLabel: document.getElementById('listeningLabel'),
  listeningHint: document.getElementById('listeningHint'),
  micOrb: document.getElementById('micOrb'),
  meterFill: document.getElementById('meterFill'),
  stopButton: document.getElementById('stopButton'),
  cancelButton: document.getElementById('cancelButton'),
  processingPanel: document.getElementById('processingPanel'),
  errorPanel: document.getElementById('errorPanel'),
  errorText: document.getElementById('errorText'),
  retryButton: document.getElementById('retryButton'),
  errorBackButton: document.getElementById('errorBackButton'),
  wordLayer: document.getElementById('wordLayer'),
  transcriptToast: document.getElementById('transcriptToast'),
  transcriptText: document.getElementById('transcriptText'),
  bottomControls: document.getElementById('bottomControls'),
  speakAgainButton: document.getElementById('speakAgainButton'),
  clearButton: document.getElementById('clearButton'),
};

const palette = ['#6844c4', '#8f5aca', '#6f9d65', '#e3b918', '#d66b4c', '#4d87b7', '#bc5d93'];
const MAX_RECORD_MS = 7000;
const SILENCE_MS = 900;
const SPEECH_THRESHOLD = 0.035;

let groupCount = 0;
let mediaRecorder = null;
let audioStream = null;
let audioContext = null;
let analyser = null;
let animationFrame = null;
let recordedChunks = [];
let recordStartedAt = 0;
let lastLoudAt = 0;
let hasHeardSpeech = false;
let cancelled = false;

function setView(view) {
  els.introCard.hidden = view !== 'intro';
  els.listeningPanel.hidden = view !== 'listening';
  els.processingPanel.hidden = view !== 'processing';
  els.errorPanel.hidden = view !== 'error';
}

function normalizeWord(raw) {
  return (raw || '')
    .toLocaleLowerCase('id-ID')
    .trim()
    .replace(/[^a-zA-ZÀ-ÿ\s-]/g, '')
    .split(/\s+/)[0]
    .slice(0, 18);
}

function showToast(word) {
  els.transcriptText.textContent = word;
  els.transcriptToast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.transcriptToast.hidden = true; }, 2800);
}

function getPlacement(index) {
  const placements = [
    { left: 10, top: 23 }, { left: 50, top: 52 }, { left: 9, top: 68 },
    { left: 42, top: 18 }, { left: 22, top: 44 },
  ];
  return placements[index % placements.length];
}

function makeLetterCreature(char, color, index) {
  const node = document.createElement('div');
  node.className = 'letter-creature';
  node.style.setProperty('--delay', `${index * 150}ms`);
  node.style.setProperty('--entry-rotate', `${(index % 2 ? 1 : -1) * (5 + (index % 4) * 2)}deg`);
  node.style.setProperty('--letter-color', color);
  node.innerHTML = `<span class="letter-body">${char}</span><span class="leg left"></span><span class="leg right"></span>`;
  return node;
}

function spawnWord(rawWord) {
  const word = normalizeWord(rawWord);
  if (!word) return;
  setView('none');
  els.bottomControls.hidden = false;
  showToast(word);

  const group = document.createElement('div');
  group.className = 'word-group';
  group.setAttribute('aria-label', word);
  const placement = getPlacement(groupCount);
  const offsetX = ((groupCount * 13) % 18) - 8;
  const offsetY = ((groupCount * 9) % 10) - 5;
  group.style.left = `${Math.min(72, Math.max(4, placement.left + offsetX))}%`;
  group.style.top = `${Math.min(76, Math.max(12, placement.top + offsetY))}%`;
  group.style.setProperty('--drift-duration', `${8 + (groupCount % 5)}s`);
  const color = palette[groupCount % palette.length];
  [...word].forEach((char, index) => group.appendChild(makeLetterCreature(char, color, index)));
  els.wordLayer.appendChild(group);
  groupCount += 1;
}

async function checkWhisper() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Server tidak siap');
    els.engineStatus.textContent = `Whisper ${data.model} · ${data.device} · lokal`;
    els.engineStatus.classList.add('ok');
  } catch (err) {
    els.engineStatus.textContent = 'Server Whisper belum tersambung';
    els.engineStatus.classList.add('bad');
  }
}

function cleanupAudio() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }
  analyser = null;
  els.meterFill.style.width = '0%';
  els.micOrb.style.setProperty('--level', '0');
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  return candidates.find(type => window.MediaRecorder?.isTypeSupported(type)) || '';
}

function stopRecording({ isCancel = false } = {}) {
  cancelled = isCancel;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    cleanupAudio();
    setView(groupCount ? 'none' : 'intro');
  }
}

function watchSilence() {
  if (!analyser || !mediaRecorder || mediaRecorder.state !== 'recording') return;
  const bins = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(bins);
  let sum = 0;
  for (const value of bins) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / bins.length);
  const level = Math.min(1, rms * 8);
  els.meterFill.style.width = `${Math.max(4, level * 100)}%`;
  els.micOrb.style.setProperty('--level', String(level));

  const now = performance.now();
  if (rms > SPEECH_THRESHOLD) {
    hasHeardSpeech = true;
    lastLoudAt = now;
    els.listeningLabel.textContent = 'Ya, terus…';
    els.listeningHint.textContent = 'Berhenti bicara sebentar untuk mengirim.';
  }

  if (hasHeardSpeech && now - lastLoudAt > SILENCE_MS) {
    stopRecording();
    return;
  }
  if (now - recordStartedAt > MAX_RECORD_MS) {
    stopRecording();
    return;
  }
  animationFrame = requestAnimationFrame(watchSilence);
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError('Browser ini belum mendukung perekaman microphone. Gunakan Chrome/Edge/Safari versi terbaru di localhost.');
    return;
  }
  try {
    cancelled = false;
    recordedChunks = [];
    hasHeardSpeech = false;
    lastLoudAt = performance.now();
    recordStartedAt = performance.now();
    els.listeningLabel.textContent = 'Dengarkan…';
    els.listeningHint.textContent = 'Ucapkan satu kata. Akan berhenti otomatis setelah hening.';
    setView('listening');

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onerror = event => {
      cleanupAudio();
      showError(`Perekaman gagal: ${event.error?.message || 'unknown error'}`);
    };

    mediaRecorder.onstop = async () => {
      const type = mediaRecorder.mimeType || mimeType || 'audio/webm';
      cleanupAudio();
      if (cancelled) {
        setView(groupCount ? 'none' : 'intro');
        return;
      }
      if (!recordedChunks.length || !hasHeardSpeech) {
        showError('Belum terdengar suara yang cukup jelas. Coba bicara sedikit lebih dekat ke microphone.');
        return;
      }
      const blob = new Blob(recordedChunks, { type });
      await transcribe(blob, type);
    };

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(audioStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);

    mediaRecorder.start(180);
    animationFrame = requestAnimationFrame(watchSilence);
  } catch (err) {
    cleanupAudio();
    if (err?.name === 'NotAllowedError') {
      showError('Izin microphone ditolak. Izinkan microphone untuk localhost lalu coba lagi.');
    } else {
      showError(`Tidak bisa membuka microphone: ${err.message || err}`);
    }
  }
}

async function transcribe(blob, mimeType) {
  setView('processing');
  const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
  const form = new FormData();
  form.append('audio', blob, `speech.${extension}`);
  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Transkripsi gagal');
    const word = normalizeWord(data.text);
    if (!word) {
      showError('Whisper belum menangkap kata yang jelas. Coba ulangi dengan satu kata saja.');
      return;
    }
    spawnWord(word);
  } catch (err) {
    showError(err.message || 'Tidak dapat menghubungi Whisper lokal.');
  }
}

function showError(message) {
  els.errorText.textContent = message;
  setView('error');
}

els.startButton.addEventListener('click', startRecording);
els.speakAgainButton.addEventListener('click', startRecording);
els.retryButton.addEventListener('click', startRecording);
els.stopButton.addEventListener('click', () => stopRecording());
els.cancelButton.addEventListener('click', () => stopRecording({ isCancel: true }));
els.errorBackButton.addEventListener('click', () => setView(groupCount ? 'none' : 'intro'));
els.demoButton.addEventListener('click', () => spawnWord('hutan'));
els.clearButton.addEventListener('click', () => {
  els.wordLayer.innerHTML = '';
  groupCount = 0;
  els.bottomControls.hidden = true;
  setView('intro');
});

checkWhisper();
