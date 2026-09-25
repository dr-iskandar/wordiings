# Wordlings — Mic + Local Whisper MVP

MVP ini sudah mengganti Web Speech API dengan **microphone recording + faster-whisper lokal**.

## User journey

1. Buka app di `http://localhost:8080`.
2. Tekan **Mulai bicara** dan izinkan microphone.
3. Ucapkan **satu kata Bahasa Indonesia**.
4. App mendeteksi suara dan berhenti otomatis setelah sekitar 0,9 detik hening (atau tekan **Selesai sekarang**).
5. Audio dikirim hanya ke server lokal di komputer yang sama.
6. `faster-whisper` mentranskripsikan Bahasa Indonesia.
7. Kata pertama diambil lalu hurufnya muncul satu per satu sebagai karakter animasi.
8. Tekan tombol mic lagi untuk menambahkan kata berikutnya ke playground.

## Setup Mac / Windows / Linux

Butuh Python 3.10+.

```bash
python -m venv .venv
```

Mac/Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

Lalu buka:

```text
http://localhost:8080
```

> Microphone browser bekerja di `localhost` atau HTTPS. Jangan buka `index.html` langsung dari Finder/Explorer.

## Offline

Default model adalah `small`. Pada **run pertama**, faster-whisper akan mengunduh model bila belum ada di cache. Setelah model sudah tersimpan, app dapat dipakai tanpa internet.

Untuk model lebih ringan:

Mac/Linux:

```bash
WHISPER_MODEL=base python server.py
```

Windows PowerShell:

```powershell
$env:WHISPER_MODEL="base"
python server.py
```

Untuk mesin NVIDIA, contoh:

```bash
WHISPER_DEVICE=cuda WHISPER_COMPUTE_TYPE=float16 python server.py
```

## Catatan

- STT benar-benar memakai **Whisper**, bukan `SpeechRecognition` browser.
- Audio tidak dikirim ke cloud oleh app ini; request menuju `/api/transcribe` di server lokal.
- `faster-whisper` menggunakan PyAV sehingga tidak perlu proses CLI `ffmpeg` terpisah untuk file audio yang umum.
- Untuk instalasi publik yang bising, threshold VAD browser dapat disetel di `app.js`: `SPEECH_THRESHOLD`, `SILENCE_MS`, dan `MAX_RECORD_MS`.

## File utama

- `server.py` — FastAPI + faster-whisper.
- `app.js` — capture mic, silence detection, upload audio, animation flow.
- `index.html` — user journey.
- `styles.css` — visual dan animated letters.
