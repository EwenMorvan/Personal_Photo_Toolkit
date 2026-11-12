/* ══════════════════════════════════════════════════════
   PhotoChooser – Video scopes (Waveform / Parade / Vectorscope / Histogram)
══════════════════════════════════════════════════════ */
(function () {
  const LUMA = [0.2126, 0.7152, 0.0722];

  class Scopes {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.mode = "waveform";
      this.last = null;
    }

    setMode(m) { this.mode = m; if (this.last) this.update(this.last); }

    _fit() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(50, Math.round(r.width * dpr)), h = Math.max(50, Math.round(r.height * dpr));
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      return { w, h, dpr };
    }

    update(frame) {
      this.last = frame;
      const { w, h, dpr } = this._fit();
      const ctx = this.ctx;
      ctx.fillStyle = "#0b0d12";
      ctx.fillRect(0, 0, w, h);
      if (!frame) return;
      if (this.mode === "waveform") this._wave(frame, w, h, dpr, false);
      else if (this.mode === "parade") this._wave(frame, w, h, dpr, true);
      else if (this.mode === "vector") this._vector(frame, w, h, dpr);
      else this._histo(frame, w, h, dpr);
    }

    _grid(w, h, dpr, top, bottom, left, right) {
      const ctx = this.ctx;
      ctx.strokeStyle = "#ffffff1c";
      ctx.fillStyle = "#ffffff55";
      ctx.lineWidth = 1;
      ctx.font = `${9 * dpr}px Segoe UI, sans-serif`;
      ctx.textBaseline = "middle";
      for (const v of [0, 128, 256, 384, 512, 640, 768, 896, 1023]) {
        const y = Math.round(bottom - (v / 1023) * (bottom - top)) + 0.5;
        ctx.globalAlpha = v % 256 === 0 || v === 1023 ? 1 : 0.45;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        if (v % 256 === 0 || v === 1023) ctx.fillText(String(v), 3 * dpr, y);
      }
      ctx.globalAlpha = 1;
    }

    _wave(f, w, h, dpr, parade) {
      const ctx = this.ctx;
      const left = 28 * dpr, right = w - 4 * dpr, top = 6 * dpr, bottom = h - 6 * dpr;
      const pw = Math.round(right - left), ph = Math.round(bottom - top);
      this._grid(w, h, dpr, top, bottom, left, right);
      const { pixels: px, width: fw, height: fh } = f;
      const nCh = parade ? 3 : 1;
      const colW = parade ? Math.floor(pw / 3) : pw;
      const acc = new Float32Array(pw * ph * (parade ? 1 : 3));
      const img = ctx.createImageData(pw, ph);
      const d = img.data;
      const bins = ph - 1;
      if (parade) {
        const accs = [new Float32Array(colW * ph), new Float32Array(colW * ph), new Float32Array(colW * ph)];
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          const i = (y * fw + x) * 4, col = Math.min(colW - 1, (x * colW / fw) | 0);
          for (let c = 0; c < 3; c++) accs[c][Math.round((1 - px[i + c] / 255) * bins) * colW + col]++;
        }
        const k = this._gain(fw * fh, colW * ph);
        const tints = [[255, 70, 70], [70, 255, 110], [80, 140, 255]];
        for (let c = 0; c < 3; c++) {
          const a = accs[c], off = c * colW + (c ? 2 : 0);
          for (let r = 0; r < ph; r++) for (let x = 0; x < colW; x++) {
            const v = a[r * colW + x]; if (!v) continue;
            const t = 1 - Math.exp(-v * k), o = (r * pw + Math.min(pw - 1, x + off)) * 4;
            d[o] = tints[c][0] * t; d[o + 1] = tints[c][1] * t; d[o + 2] = tints[c][2] * t; d[o + 3] = 255 * Math.min(1, t * 1.6);
          }
        }
      } else {
        // luma waveform, dots tinted with average pixel colour (Resolve-style)
        const cnt = new Float32Array(pw * ph);
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          const i = (y * fw + x) * 4;
          const Y = (LUMA[0] * px[i] + LUMA[1] * px[i + 1] + LUMA[2] * px[i + 2]) / 255;
          const o = Math.round((1 - Y) * bins) * pw + Math.min(pw - 1, (x * pw / fw) | 0);
          cnt[o]++; acc[o * 3] += px[i]; acc[o * 3 + 1] += px[i + 1]; acc[o * 3 + 2] += px[i + 2];
        }
        const k = this._gain(fw * fh, pw * ph);
        for (let o = 0; o < pw * ph; o++) {
          const v = cnt[o]; if (!v) continue;
          const t = 1 - Math.exp(-v * k);
          // mostly white trace, slightly tinted by the real colour
          const r = acc[o * 3] / v, g = acc[o * 3 + 1] / v, b = acc[o * 3 + 2] / v;
          const mix = 0.35;
          d[o * 4] = (200 * (1 - mix) + r * mix) * t + 30 * t;
          d[o * 4 + 1] = (230 * (1 - mix) + g * mix) * t + 25 * t;
          d[o * 4 + 2] = (200 * (1 - mix) + b * mix) * t + 20 * t;
          d[o * 4 + 3] = 255 * Math.min(1, t * 1.6);
        }
      }
      this._blit(img, left, top);
      if (parade) {
        ctx.strokeStyle = "#ffffff22";
        for (const c of [1, 2]) {
          const x = Math.round(left + c * colW) + 0.5;
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        }
      }
    }

    _gain(nPix, nBins) {
      const expected = nPix / nBins;      // mean hits per bin if spread uniformly
      return 1 / Math.max(expected * 1.1, 0.25);
    }

    _blit(img, x, y) {
      const tmp = this._tmp || (this._tmp = document.createElement("canvas"));
      tmp.width = img.width; tmp.height = img.height;
      tmp.getContext("2d").putImageData(img, 0, 0);
      this.ctx.globalCompositeOperation = "lighter";
      this.ctx.drawImage(tmp, x, y);
      this.ctx.globalCompositeOperation = "source-over";
    }

    _vector(f, w, h, dpr) {
      const ctx = this.ctx;
      const size = Math.min(w, h) - 12 * dpr, R = size / 2;
      const cx = w / 2, cy = h / 2;
      // graticule
      ctx.strokeStyle = "#ffffff22"; ctx.lineWidth = 1;
      for (const r of [R, R * 0.75, R * 0.5, R * 0.25]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      // scale: |CbCr| = 0.5 → radius R
      const toXY = (cb, cr) => [cx + cb / 0.5 * R, cy - cr / 0.5 * R];
      const ycc = (r, g, b) => { const y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b; return [(b - y) / 1.8556, (r - y) / 1.5748]; };
      // skin tone line
      const sk = ycc(0.85, 0.62, 0.5), sl = Math.hypot(...sk);
      ctx.strokeStyle = "#f0b08066"; ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...toXY(sk[0] / sl * 0.5, sk[1] / sl * 0.5)); ctx.stroke();
      ctx.setLineDash([]);
      // 75% targets
      const targets = [["R", [0.75, 0, 0], "#ff5a5a"], ["Yl", [0.75, 0.75, 0], "#ffe55a"], ["G", [0, 0.75, 0], "#5aff7a"],
                       ["Cy", [0, 0.75, 0.75], "#5affff"], ["B", [0, 0, 0.75], "#5a8aff"], ["Mg", [0.75, 0, 0.75], "#ff5aff"]];
      ctx.font = `${9 * dpr}px Segoe UI, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const [name, rgb, col] of targets) {
        const [x, y] = toXY(...ycc(...rgb));
        const b = 5 * dpr;
        ctx.strokeStyle = col + "aa"; ctx.strokeRect(x - b, y - b, 2 * b, 2 * b);
        const l = Math.hypot(x - cx, y - cy) || 1;
        ctx.fillStyle = col + "cc"; ctx.fillText(name, x + (x - cx) / l * 14 * dpr, y + (y - cy) / l * 14 * dpr);
      }
      ctx.textAlign = "start";
      // trace
      const n = Math.ceil(size), img = ctx.createImageData(n, n), d = img.data;
      const cnt = new Float32Array(n * n), acc = new Float32Array(n * n * 3);
      const { pixels: px, width: fw, height: fh } = f;
      for (let i = 0; i < fw * fh * 4; i += 4) {
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const [cb, cr] = ycc(r, g, b);
        const x = Math.round(n / 2 + cb / 0.5 * R), y = Math.round(n / 2 - cr / 0.5 * R);
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const o = y * n + x;
        cnt[o]++; acc[o * 3] += px[i]; acc[o * 3 + 1] += px[i + 1]; acc[o * 3 + 2] += px[i + 2];
      }
      const k = this._gain(fw * fh, n * n * 0.08);
      for (let o = 0; o < n * n; o++) {
        const v = cnt[o]; if (!v) continue;
        const t = 1 - Math.exp(-v * k);
        let r = acc[o * 3] / v, g = acc[o * 3 + 1] / v, b = acc[o * 3 + 2] / v;
        const m = Math.max(r, g, b, 1); r = r / m * 255; g = g / m * 255; b = b / m * 255;   // colour at full brightness
        d[o * 4] = (r * 0.6 + 100) * t; d[o * 4 + 1] = (g * 0.6 + 100) * t; d[o * 4 + 2] = (b * 0.6 + 100) * t;
        d[o * 4 + 3] = 255 * Math.min(1, t * 1.8);
      }
      this._blit(img, Math.round(cx - n / 2), Math.round(cy - n / 2));
    }

    _histo(f, w, h, dpr) {
      const ctx = this.ctx;
      const left = 6 * dpr, right = w - 6 * dpr, top = 8 * dpr, bottom = h - 8 * dpr;
      const hist = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
      const { pixels: px } = f;
      for (let i = 0; i < px.length; i += 4) { hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++; }
      // ignore the extreme bins when scaling (clipping spikes)
      let max = 1;
      for (const hc of hist) for (let i = 1; i < 255; i++) max = Math.max(max, hc[i]);
      ctx.strokeStyle = "#ffffff14";
      for (let q = 0; q <= 4; q++) {
        const x = Math.round(left + q / 4 * (right - left)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      }
      ctx.globalCompositeOperation = "lighter";
      const cols = ["rgba(255,70,70,0.55)", "rgba(70,230,100,0.55)", "rgba(80,130,255,0.6)"];
      hist.forEach((hc, c) => {
        ctx.fillStyle = cols[c];
        ctx.beginPath(); ctx.moveTo(left, bottom);
        for (let i = 0; i < 256; i++) {
          const x = left + i / 255 * (right - left);
          const y = bottom - Math.min(1, Math.sqrt(hc[i] / max)) * (bottom - top);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(right, bottom); ctx.closePath(); ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
      // clipping indicators
      const n = px.length / 4;
      const lo = (hist[0][0] + hist[1][0] + hist[2][0]) / (3 * n), hi = (hist[0][255] + hist[1][255] + hist[2][255]) / (3 * n);
      ctx.font = `${9 * dpr}px Segoe UI, sans-serif`;
      ctx.fillStyle = lo > 0.005 ? "#6c8fff" : "#ffffff44";
      ctx.fillText(`▼ ${(lo * 100).toFixed(1)}%`, left + 2 * dpr, top + 6 * dpr);
      ctx.fillStyle = hi > 0.005 ? "#ff5f72" : "#ffffff44";
      ctx.textAlign = "right";
      ctx.fillText(`${(hi * 100).toFixed(1)}% ▲`, right - 2 * dpr, top + 6 * dpr);
      ctx.textAlign = "start";
    }
  }

  window.Scopes = Scopes;
})();
