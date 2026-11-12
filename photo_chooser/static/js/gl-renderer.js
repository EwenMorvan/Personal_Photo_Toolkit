/* ══════════════════════════════════════════════════════
   PhotoChooser – WebGL2 grading renderer
   The fragment shader mirrors grading.apply_grade_array /
   grading.apply_geometry. Keep them in sync.
══════════════════════════════════════════════════════ */
(function () {
  const VS = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler3D;
  precision highp sampler2DArray;

  uniform sampler2D uSrc;
  uniform highp sampler2D uCurve;   // 1024 x 1 RGBA32F
  uniform sampler3D uLut;           // N^3 RGBA32F

  uniform vec2  uOutSize;
  uniform bool  uTopDown;           // FBO read-back: row 0 = top of image
  // geometry
  uniform int   uRot;
  uniform bool  uFlip;
  uniform float uAngle;
  uniform float uScale;
  uniform vec4  uCrop;
  uniform vec2  uOriSize;
  // compare
  uniform bool  uBypass;
  uniform float uSplit;             // < 0: no split; else x (0..1) of the wipe
  // grade
  uniform bool  uWbOn;
  uniform vec3  uWB, uOffset, uLift, uGain, uGExp;
  uniform float uContrast, uPivot, uSh, uHl;
  uniform bool  uCurvesOn;
  uniform bool  uColorOn;
  uniform float uHueCos, uHueSin, uSat, uBoost;
  uniform bool  uLutOn;
  uniform int   uLutSize;
  uniform float uLutMix;
  uniform vec3  uLutMin, uLutMax;
  // pre-grade: dehaze / clarity + local adjustment layers (zones)
  uniform vec2  uSrcSize;
  uniform float uSharp;             // sharpening amount (fine 3x3 detail of the source luma)
  float gLod = 0.0;                 // mip level the source is displayed at (set in main)
  uniform sampler3D uAiLut;         // learned per-photo LUT (33^3)
  uniform bool  uAiOn;
  uniform float uAi;
  uniform sampler2D uAux;           // R: blurred luma, G: haze transmission
  uniform sampler2D uMaskA, uMaskB; // AI masks (8 channels)
  uniform sampler2DArray uPaint;    // per layer: R add, G erase
  uniform bool  uAuxOn, uMasksOn;
  uniform vec3  uAir;
  uniform float uDehaze, uClarity;
  uniform int   uNL;
  uniform int   uLOn[6], uLMask[6], uLPaint[6], uLWbOn[6];
  uniform float uLInv[6], uLAmt[6], uLClar[6];
  uniform vec3  uLWB[6];
  uniform vec4  uLP[6];             // contrast, shadows, highlights, saturation
  uniform bool  uOvOn;              // red overlay of one layer's mask
  uniform int   uOvMask, uOvPaint;
  uniform float uOvInv, uOvAlpha;
  uniform vec3  uOvColor;

  out vec4 outColor;
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec3 s2l(vec3 x) {
    return mix(x / 12.92, pow((max(x, 0.0) + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), x));
  }
  vec3 l2s(vec3 x) {
    x = max(x, 0.0);
    return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
  }

  float curve(float v, int ch) {
    float p = clamp(v, 0.0, 1.0) * 1023.0;
    int i0 = clamp(int(floor(p)), 0, 1022);
    float f = p - float(i0);
    float a = texelFetch(uCurve, ivec2(i0, 0), 0)[ch];
    float b = texelFetch(uCurve, ivec2(i0 + 1, 0), 0)[ch];
    return a + (b - a) * f;
  }

  vec3 lut3d(vec3 c) {
    vec3 v = clamp((c - uLutMin) / max(uLutMax - uLutMin, vec3(1e-6)), 0.0, 1.0);
    float n = float(uLutSize - 1);
    vec3 p = v * n;
    ivec3 i = clamp(ivec3(floor(p)), ivec3(0), ivec3(uLutSize - 2));
    vec3 f = p - vec3(i);
    #define L(dr, dg, db) texelFetch(uLut, i + ivec3(dr, dg, db), 0).rgb
    vec3 c00 = mix(L(0,0,0), L(1,0,0), f.r);
    vec3 c10 = mix(L(0,1,0), L(1,1,0), f.r);
    vec3 c01 = mix(L(0,0,1), L(1,0,1), f.r);
    vec3 c11 = mix(L(0,1,1), L(1,1,1), f.r);
    return mix(mix(c00, c10, f.g), mix(c01, c11, f.g), f.b);
  }

  vec3 aiLut(vec3 c) {
    vec3 p = clamp(c, 0.0, 1.0) * 32.0;
    ivec3 i = clamp(ivec3(floor(p)), ivec3(0), ivec3(31));
    vec3 f = p - vec3(i);
    #define A(dr, dg, db) texelFetch(uAiLut, i + ivec3(dr, dg, db), 0).rgb
    vec3 c00 = mix(A(0,0,0), A(1,0,0), f.r);
    vec3 c10 = mix(A(0,1,0), A(1,1,0), f.r);
    vec3 c01 = mix(A(0,0,1), A(1,0,1), f.r);
    vec3 c11 = mix(A(0,1,1), A(1,1,1), f.r);
    return mix(mix(c00, c10, f.g), mix(c01, c11, f.g), f.b);
  }

  float layerMask(int k, float inv, int ps, vec4 ma, vec4 mb, vec2 s) {
    float m = 0.0;
    if (k >= 0 && uMasksOn) {
      m = k < 4 ? ma[k] : mb[k - 4];
      if (inv > 0.5) m = 1.0 - m;
    }
    if (ps >= 0) {
      vec2 p = textureLod(uPaint, vec3(s, float(ps)), 0.0).rg;
      m = clamp(m + p.r, 0.0, 1.0) * (1.0 - p.g);
    }
    return m;
  }

  vec3 pre(vec3 c, vec2 s, vec4 ma, vec4 mb) {
    float detail = 0.0, w = 0.0;
    if (uAiOn && uAi != 0.0) c = c + (aiLut(c) - c) * uAi;
    float fine = 0.0;
    if (uSharp != 0.0) {
      // same kernel as grading.fine_detail, taken at the displayed scale (100 % zoom = export)
      vec2 st = exp2(gLod) / uSrcSize;
      #define YL(dx, dy) dot(textureLod(uSrc, s + vec2(dx, dy) * st, gLod).rgb, LUMA)
      float yc = YL(0.0, 0.0);
      float bl = (4.0 * yc + 2.0 * (YL(-1.0, 0.0) + YL(1.0, 0.0) + YL(0.0, -1.0) + YL(0.0, 1.0))
                  + YL(-1.0, -1.0) + YL(1.0, -1.0) + YL(-1.0, 1.0) + YL(1.0, 1.0)) / 16.0;
      fine = clamp(yc - bl, -0.08, 0.08);
    }
    if (uAuxOn) {
      vec2 ax = textureLod(uAux, s, 0.0).rg;
      float ysrc = dot(c, LUMA);
      detail = ysrc - ax.r;
      w = clamp(1.0 - pow(abs(2.0 * ysrc - 1.0), 3.0), 0.0, 1.0);
      if (uDehaze != 0.0) {
        float ts = max(1.0 - uDehaze * (1.0 - ax.g), 0.25);
        c = mix((c - uAir) / ts + uAir, c, step(uAir, c));   // brighter than the haze: untouched
      }
      if (uClarity != 0.0) c += uClarity * detail * w;
    }
    c += uSharp * fine;
    for (int i = 0; i < 6; i++) {
      if (i >= uNL) break;
      if (uLOn[i] == 0) continue;
      float m = layerMask(uLMask[i], uLInv[i], uLPaint[i], ma, mb, s) * uLAmt[i];
      if (m <= 0.0) continue;
      vec3 a = c;
      if (uLWbOn[i] == 1) a = l2s(s2l(a) * uLWB[i]);
      a = (a - 0.435) * uLP[i].x + 0.435;
      if (uLP[i].y != 0.0 || uLP[i].z != 0.0) {
        float y = clamp(dot(a, LUMA), 0.0, 1.0);
        float ws = pow(clamp(1.0 - y / 0.6, 0.0, 1.0), 2.0);
        float wh = pow(clamp((y - 0.4) / 0.6, 0.0, 1.0), 2.0);
        a *= exp2(uLP[i].y * ws + uLP[i].z * wh);
      }
      float y2 = dot(a, LUMA);
      a = y2 + (a - y2) * uLP[i].w;
      a += uLClar[i] * detail * w;
      c = mix(c, a, m);
    }
    return c;
  }

  vec3 grade(vec3 c) {
    if (uWbOn) c = l2s(s2l(c) * uWB);
    c = c + uOffset;
    c = uGain * (c + uLift * (1.0 - c));
    c = pow(max(c, 0.0), uGExp);
    c = (c - uPivot) * uContrast + uPivot;
    if (uSh != 0.0 || uHl != 0.0) {
      float y = clamp(dot(c, LUMA), 0.0, 1.0);
      float ws = pow(clamp(1.0 - y / 0.6, 0.0, 1.0), 2.0);
      float wh = pow(clamp((y - 0.4) / 0.6, 0.0, 1.0), 2.0);
      c *= exp2(uSh * ws + uHl * wh);
    }
    if (uCurvesOn) c = vec3(curve(c.r, 0), curve(c.g, 1), curve(c.b, 2));
    if (uColorOn) {
      float y = dot(c, LUMA);
      float cb = (c.b - y) / 1.8556, cr = (c.r - y) / 1.5748;
      float cb2 = cb * uHueCos - cr * uHueSin;
      float cr2 = cb * uHueSin + cr * uHueCos;
      float chroma = sqrt(cb2 * cb2 + cr2 * cr2);
      float f = uSat * (1.0 + uBoost * (1.0 - clamp(chroma * 2.5, 0.0, 1.0)));
      cb2 *= f; cr2 *= f;
      float r = y + 1.5748 * cr2;
      float b = y + 1.8556 * cb2;
      float g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
      c = vec3(r, g, b);
    }
    if (uLutOn) c = c + (lut3d(clamp(c, 0.0, 1.0)) - c) * uLutMix;
    return clamp(c, 0.0, 1.0);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uOutSize;
    if (!uTopDown) uv.y = 1.0 - uv.y;

    // output → straightened base frame → oriented frame
    vec2 bu = uCrop.xy + uv * uCrop.zw;
    vec2 q = (bu - 0.5) * uOriSize * uScale;
    float cs = cos(uAngle), sn = sin(uAngle);
    vec2 p = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    vec2 o = p / uOriSize + 0.5;
    // oriented → source (undo flip, then undo clockwise rotation)
    if (uFlip) o.x = 1.0 - o.x;
    vec2 s = o;
    if (uRot == 90)       s = vec2(o.y, 1.0 - o.x);
    else if (uRot == 180) s = vec2(1.0 - o.x, 1.0 - o.y);
    else if (uRot == 270) s = vec2(1.0 - o.y, o.x);

    vec3 c = texture(uSrc, s).rgb;     // sample before branching (mipmap derivatives)
    vec2 px = s * uSrcSize;
    gLod = max(0.0, 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))));
    if (any(lessThan(s, vec2(0.0))) || any(greaterThan(s, vec2(1.0)))) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    bool orig = uBypass || (uSplit >= 0.0 && uv.x < uSplit);
    vec4 ma = textureLod(uMaskA, s, 0.0), mb = textureLod(uMaskB, s, 0.0);
    vec3 col = orig ? c : grade(pre(c, s, ma, mb));
    if (uOvOn) col = mix(col, uOvColor, uOvAlpha * layerMask(uOvMask, uOvInv, uOvPaint, ma, mb, s));
    outColor = vec4(col, 1.0);
  }`;

  class GradeRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
      if (!gl) throw new Error("WebGL2 non disponible dans ce navigateur");
      this.gl = gl;
      this.prog = this._program(VS, FS);
      this.loc = {};
      const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(this.prog, i).name;
        this.loc[name] = gl.getUniformLocation(this.prog, name);
      }
      // full-screen triangle pair
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(this.prog, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      this.vao = vao;

      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);       // RG8 / odd-width uploads

      this.srcTex = this._tex2d();
      this.curveTex = this._tex2d(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, 1, 0, gl.RGBA, gl.FLOAT, window.Grade.buildCurveLut({}));
      this.lutTex = gl.createTexture();
      this._setLutData(2, new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0, 0,0,1, 1,0,1, 0,1,1, 1,1,1]));
      this.lut = null;
      this.curveKey = "";
      // zone resources (1x1 placeholders until the photo's maps arrive)
      this.auxTex = this._tex2d(); this.maskATex = this._tex2d(); this.maskBTex = this._tex2d();
      this.paintTex = gl.createTexture();
      this.aiLutTex = gl.createTexture();
      this.clearMaps();
      this.fbo = gl.createFramebuffer();
      this.fboTex = null; this.fboW = 0; this.fboH = 0;
      this.srcW = 0; this.srcH = 0;
    }

    _program(vs, fs) {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    _tex2d(filter) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    setImage(img) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // mipmaps: clean downscaling when the photo is shown smaller than its size (no aliasing)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.srcW = img.naturalWidth || img.width;
      this.srcH = img.naturalHeight || img.height;
    }

    _setLutData(size, rgb) {
      const gl = this.gl;
      const rgba = new Float32Array(size ** 3 * 4);
      for (let i = 0; i < size ** 3; i++) {
        rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 1;
      }
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, size, size, size, 0, gl.RGBA, gl.FLOAT, rgba);
    }

    clearMaps() {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.auxTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array([128, 255]));
      for (const t of [this.maskATex, this.maskBTex]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      }
      this.auxOn = false; this.masksOn = false; this.air = [1, 1, 1];
      gl.bindTexture(gl.TEXTURE_3D, this.aiLutTex);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.NEAREST);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
      this.aiOn = false;
      this.allocPaint(1, 1);
    }

    /** rgb: Float32Array(33^3 * 3), red fastest – the photo's learned LUT */
    setAiLut(rgb) {
      const gl = this.gl, n = 33, rgba = new Float32Array(n ** 3 * 4);
      for (let i = 0; i < n ** 3; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 1; }
      gl.bindTexture(gl.TEXTURE_3D, this.aiLutTex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
      this.aiOn = true;
    }

    /** rg: Uint8Array(w*h*2) [blurred luma, transmission] */
    setAux(w, h, rg, air) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.auxTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, rg);
      this.auxOn = true; this.air = air;
    }

    /** a, b: Uint8Array(w*h*4) – the 8 AI mask channels */
    setMasks(w, h, a, b) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.maskATex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
      gl.bindTexture(gl.TEXTURE_2D, this.maskBTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
      this.masksOn = true;
    }

    /** (Re)allocate the brush paint array: 6 layers of w x h, RG8, zero-filled */
    allocPaint(w, h) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.paintTex);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG8, w, h, 6, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(w * h * 12));
      this.paintW = w; this.paintH = h;
    }

    /** rg: Uint8Array(paintW*paintH*2) or null (clears the slot) */
    setPaint(slot, rg) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.paintTex);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, this.paintW, this.paintH, 1, gl.RG, gl.UNSIGNED_BYTE,
                       rg || new Uint8Array(this.paintW * this.paintH * 2));
    }

    /** lut: result of Grade.parseCube, or null */
    setLut(lut) {
      if (lut === this.lut) return;
      this.lut = lut;
      if (lut) this._setLutData(lut.size, lut.data);
    }

    _setCurves(curves) {
      const key = JSON.stringify(curves);
      if (key === this.curveKey) return;
      this.curveKey = key;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, 1, 0, gl.RGBA, gl.FLOAT, window.Grade.buildCurveLut(curves));
    }

    /**
     * opts: { grade, geo, ignoreCrop, bypass, split, width, height, topDown }
     */
    _draw(opts) {
      const gl = this.gl, L = this.loc, G = window.Grade;
      const g = opts.grade, geom = G.geometry(this.srcW, this.srcH, opts.geo, opts.ignoreCrop);
      const u = G.uniforms(g);
      gl.useProgram(this.prog);
      gl.bindVertexArray(this.vao);
      gl.viewport(0, 0, opts.width, opts.height);

      gl.activeTexture(gl.TEXTURE1);
      this._setCurves(g.curves);       // binds on the active unit → must be unit 1
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex); gl.uniform1i(L.uCurve, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex); gl.uniform1i(L.uSrc, 0);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, this.lutTex); gl.uniform1i(L.uLut, 2);

      gl.uniform2f(L.uOutSize, opts.width, opts.height);
      gl.uniform1i(L.uTopDown, opts.topDown ? 1 : 0);
      gl.uniform1i(L.uRot, geom.rot);
      gl.uniform1i(L.uFlip, opts.geo.flip ? 1 : 0);
      gl.uniform1f(L.uAngle, geom.rad);
      gl.uniform1f(L.uScale, geom.s);
      gl.uniform4f(L.uCrop, geom.crop.x, geom.crop.y, geom.crop.w, geom.crop.h);
      gl.uniform2f(L.uOriSize, geom.oriW, geom.oriH);
      gl.uniform1i(L.uBypass, opts.bypass ? 1 : 0);
      gl.uniform1f(L.uSplit, opts.split ?? -1);

      gl.uniform1i(L.uWbOn, u.wbOn ? 1 : 0);
      gl.uniform3fv(L.uWB, u.wb);
      gl.uniform3fv(L.uOffset, u.offset);
      gl.uniform3fv(L.uLift, u.lift);
      gl.uniform3fv(L.uGain, u.gain);
      gl.uniform3fv(L.uGExp, u.gexp);
      gl.uniform1f(L.uContrast, u.contrast);
      gl.uniform1f(L.uPivot, u.pivot);
      gl.uniform1f(L.uSh, u.sh);
      gl.uniform1f(L.uHl, u.hl);
      gl.uniform1i(L.uCurvesOn, u.curvesOn ? 1 : 0);
      gl.uniform1i(L.uColorOn, u.colorOn ? 1 : 0);
      gl.uniform1f(L.uHueCos, u.hueCos);
      gl.uniform1f(L.uHueSin, u.hueSin);
      gl.uniform1f(L.uSat, u.sat);
      gl.uniform1f(L.uBoost, u.boost);
      const lutOn = !!(this.lut && g.lut && g.lut_mix > 1e-4);
      gl.uniform1i(L.uLutOn, lutOn ? 1 : 0);
      if (this.lut) {
        gl.uniform1i(L.uLutSize, this.lut.size);
        gl.uniform3fv(L.uLutMin, this.lut.min);
        gl.uniform3fv(L.uLutMax, this.lut.max);
      }
      gl.uniform1f(L.uLutMix, u.lutMix);

      // zones
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.maskATex); gl.uniform1i(L.uMaskA, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.maskBTex); gl.uniform1i(L.uMaskB, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.auxTex); gl.uniform1i(L.uAux, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.paintTex); gl.uniform1i(L.uPaint, 6);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_3D, this.aiLutTex); gl.uniform1i(L.uAiLut, 7);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(L.uSrcSize, this.srcW, this.srcH);
      gl.uniform1f(L.uSharp, u.sharpen);
      gl.uniform1i(L.uAiOn, this.aiOn ? 1 : 0);
      gl.uniform1f(L.uAi, u.ai);
      gl.uniform1i(L.uAuxOn, this.auxOn ? 1 : 0);
      gl.uniform1i(L.uMasksOn, this.masksOn ? 1 : 0);
      gl.uniform3fv(L.uAir, this.air);
      gl.uniform1f(L.uDehaze, u.dehaze);
      gl.uniform1f(L.uClarity, u.clarity);
      const Ls = u.locals, n = Ls.length;
      gl.uniform1i(L.uNL, n);
      if (n) {
        const pad = (f, d) => { const a = Ls.map(f); while (a.length < 6) a.push(d); return a; };
        gl.uniform1iv(L["uLOn[0]"], pad(l => l.on ? 1 : 0, 0));
        gl.uniform1iv(L["uLMask[0]"], pad(l => l.mask, -1));
        gl.uniform1iv(L["uLPaint[0]"], pad(l => l.paint, -1));
        gl.uniform1iv(L["uLWbOn[0]"], pad(l => l.wbOn ? 1 : 0, 0));
        gl.uniform1fv(L["uLInv[0]"], pad(l => l.invert, 0));
        gl.uniform1fv(L["uLAmt[0]"], pad(l => l.amount, 0));
        gl.uniform1fv(L["uLClar[0]"], pad(l => l.clarity, 0));
        gl.uniform3fv(L["uLWB[0]"], pad(l => l.wb, [1, 1, 1]).flat());
        gl.uniform4fv(L["uLP[0]"], pad(l => l.p, [1, 0, 0, 1]).flat());
      }
      const ov = opts.overlay;      // {mask, invert, paint} or null
      gl.uniform1i(L.uOvOn, ov ? 1 : 0);
      if (ov) {
        gl.uniform1i(L.uOvMask, ov.mask); gl.uniform1i(L.uOvPaint, ov.paint); gl.uniform1f(L.uOvInv, ov.invert);
        gl.uniform3fv(L.uOvColor, ov.color || [1, 0.12, 0.2]);
        gl.uniform1f(L.uOvAlpha, ov.alpha ?? 0.6);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return geom;
    }

    /** Draw to the visible canvas, resizing its backing store. */
    render(opts) {
      const geom = window.Grade.geometry(this.srcW, this.srcH, opts.geo, opts.ignoreCrop);
      const maxDim = opts.maxDim || 4096;
      const k = Math.min(1, maxDim / Math.max(geom.outW, geom.outH));
      const w = Math.max(1, Math.round(geom.outW * k)), h = Math.max(1, Math.round(geom.outH * k));
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this._draw({ ...opts, width: w, height: h, topDown: false });
      return geom;
    }

    /** Off-screen render → Uint8Array RGBA (row 0 = top). */
    renderPixels(opts, maxDim) {
      const gl = this.gl;
      const geom = window.Grade.geometry(this.srcW, this.srcH, opts.geo, opts.ignoreCrop);
      const k = Math.min(1, maxDim / Math.max(geom.outW, geom.outH));
      const w = Math.max(1, Math.round(geom.outW * k)), h = Math.max(1, Math.round(geom.outH * k));
      if (w !== this.fboW || h !== this.fboH) {
        if (this.fboTex) gl.deleteTexture(this.fboTex);
        this.fboTex = this._tex2d(gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
        this.fboW = w; this.fboH = h;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      this._draw({ ...opts, width: w, height: h, topDown: true });
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { pixels: px, width: w, height: h };
    }
  }

  window.GradeRenderer = GradeRenderer;
})();
