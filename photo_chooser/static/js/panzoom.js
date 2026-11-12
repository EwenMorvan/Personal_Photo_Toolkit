/* ══════════════════════════════════════════════════════
   PhotoChooser – Pan & zoom (wheel, drag, double-click)
   content is laid out at its "natural" size (1 CSS px = 1 image px)
   and transformed with translate + scale.
══════════════════════════════════════════════════════ */
(function () {
  class PanZoom {
    constructor(stage, content, { onChange, maxZoom = 4 } = {}) {
      this.stage = stage;
      this.content = content;
      this.onChange = onChange || (() => {});
      this.maxZoom = maxZoom;       // in "100 %" units (1 image px = 1 device px)
      this.w = 1; this.h = 1;
      this.s = 1; this.tx = 0; this.ty = 0;
      this.enabled = true;
      this.fitted = true;
      this._drag = null;

      content.style.position = "absolute";
      content.style.left = "0"; content.style.top = "0";
      content.style.transformOrigin = "0 0";

      stage.addEventListener("wheel", e => {
        if (!this.enabled) return;
        e.preventDefault();
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        this.zoomAt(this.s * f, e.clientX, e.clientY);
      }, { passive: false });

      stage.addEventListener("pointerdown", e => {
        if (!this.enabled || (e.button !== 0 && e.button !== 1) || this.fitted) return;
        if (e.target.closest("[data-nopan]")) return;
        if (this.canPan && !this.canPan(e)) return;      // e.g. a brush tool owns the left button
        this._drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
        stage.setPointerCapture(e.pointerId);
        stage.classList.add("panning");
      });
      stage.addEventListener("pointermove", e => {
        if (!this._drag) return;
        const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this._drag.moved = true;
        this.tx = this._drag.tx + dx; this.ty = this._drag.ty + dy;
        this._apply();
      });
      const end = () => { if (this._drag) { this.lastDragMoved = this._drag.moved; this._drag = null; stage.classList.remove("panning"); } };
      stage.addEventListener("pointerup", end);
      stage.addEventListener("pointercancel", end);

      stage.addEventListener("dblclick", e => {
        if (!this.enabled || e.target.closest("[data-nopan]")) return;
        if (this.canPan && !this.canPan(e)) return;
        if (this.fitted) this.zoomAt(this.oneToOne() >= this.fitScale() * 1.15 ? this.oneToOne() : this.fitScale() * 2.5, e.clientX, e.clientY);
        else this.fit();
      });

      this._ro = new ResizeObserver(() => { if (this.fitted) this.fit(); else this._apply(); });
      this._ro.observe(stage);
    }

    setSize(w, h, keepView = false) {
      const changed = Math.abs(w - this.w) > 0.5 || Math.abs(h - this.h) > 0.5;
      this.w = w; this.h = h;
      this.content.style.width = w + "px";
      this.content.style.height = h + "px";
      if (!keepView || changed) this.fit();
    }

    fitScale() {
      const r = this.stage.getBoundingClientRect();
      return Math.min(r.width / this.w, r.height / this.h) || 1;
    }
    oneToOne() { return 1 / (window.devicePixelRatio || 1); }

    /** zoom level expressed like Lightroom/Resolve (100 % = 1 image px per screen px) */
    percent() { return Math.round(this.s * (window.devicePixelRatio || 1) * 100); }

    fit() {
      const r = this.stage.getBoundingClientRect();
      this.s = this.fitScale();
      this.tx = (r.width - this.w * this.s) / 2;
      this.ty = (r.height - this.h * this.s) / 2;
      this.fitted = true;
      this._apply();
    }

    zoomAt(s, cx, cy) {
      const r = this.stage.getBoundingClientRect();
      const fit = this.fitScale();
      s = Math.min(Math.max(s, fit), this.oneToOne() * this.maxZoom);
      if (s <= fit * 1.001) { this.fit(); return; }
      if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
      const px = (cx - r.left - this.tx) / this.s, py = (cy - r.top - this.ty) / this.s;
      this.s = s;
      this.tx = cx - r.left - px * s;
      this.ty = cy - r.top - py * s;
      this.fitted = false;
      this._apply();
    }

    _clamp() {
      const r = this.stage.getBoundingClientRect();
      const cw = this.w * this.s, ch = this.h * this.s;
      this.tx = cw <= r.width ? (r.width - cw) / 2 : Math.min(0, Math.max(r.width - cw, this.tx));
      this.ty = ch <= r.height ? (r.height - ch) / 2 : Math.min(0, Math.max(r.height - ch, this.ty));
    }

    _apply() {
      this._clamp();
      this.content.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
      this.stage.classList.toggle("zoomed", !this.fitted);
      this.onChange(this);
    }

    /** content rect relative to the stage, in CSS px */
    rect() { return { x: this.tx, y: this.ty, w: this.w * this.s, h: this.h * this.s }; }
  }

  window.PanZoom = PanZoom;
})();
