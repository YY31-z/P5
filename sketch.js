// ====== 资源 ======
let C_raw = []; // 原图（桌面用）
let C_mobile = []; // 手机缓存缩放图（手机用）
const TOTAL = 11;

let tiltGamma = 0;
let hasDeviceTilt = false;

let doll = null;
let crackFall = null;

// ====== 平台判断：只在手机/平板启用优化 ======
const IS_MOBILE = (() => {
  const ua = navigator.userAgent || "";
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || touch;
})();

// ====== 参数 ======
const FIT_RATIO = 0.62;

// 不倒翁物理
const INPUT_TORQUE = 0.22;
const RESTORE_K = 0.085;
const DAMPING = 0.86;
const MAX_ANGLE = 24;
const IDLE_SWAY_SPEED = 0.03;
const IDLE_SWAY_AMP = 1.6;

// 缩小（差距不要太大）
const SHRINK_FACTOR = 0.94;
const MIN_SCALE_ABS = 0.08;

// 裂开与下落
const CRACK_OPEN_FRAMES = 10;
const FALL_FADE_FRAMES = 60;
const GRAVITY = 0.55;

// 防交叉
const MIN_GAP_RATIO = 0.06;

function preload() {
  for (let i = 1; i <= TOTAL; i++) {
    C_raw.push(loadImage(`assets/C/C${i}.png`));
  }
}

function setup() {
  // ✅ 关键：只在手机端限制像素密度，桌面不动
  if (IS_MOBILE) {
    const dpr = window.devicePixelRatio || 1;
    // 更流畅：1；更清晰但仍比默认轻：2
    pixelDensity(Math.min(2, dpr));
  }

  createCanvas(windowWidth, windowHeight);
  imageMode(CENTER);
  angleMode(DEGREES);

  // ✅ 只在手机端做缓存缩放，桌面不动
  if (IS_MOBILE) buildMobileCache();

  spawnRandomDoll(1.0);
  setupDeviceOrientation();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (IS_MOBILE) buildMobileCache();
  if (doll) doll.setPosition(width / 2, height / 2);
  if (crackFall) crackFall.setBase(width / 2, height / 2);
}

function draw() {
  background(255);

  const input = getInputValue();

  if (crackFall) {
    crackFall.update();
    crackFall.render();
    if (crackFall.done) {
      const img = crackFall.img; // 已经是当前平台的图
      const nextScale = computeNextScale(img, crackFall.nextScaleBase);
      doll = new RolyDoll(img, width / 2, height / 2, nextScale);
      crackFall = null;
    }
    return;
  }

  if (doll) {
    doll.update(input);
    doll.render();
  }
}

// ====== 触控更稳定（手机端建议加）=====
function touchStarted() {
  requestIOSPermissionIfNeeded();
  // 让触控等价于鼠标点击逻辑
  if (touches && touches.length > 0) {
    const t = touches[0];
    handlePress(t.x, t.y);
  }
  return false;
}
function mousePressed() {
  requestIOSPermissionIfNeeded();
  handlePress(mouseX, mouseY);
}
function handlePress(px, py) {
  if (crackFall) return;

  if (!doll) {
    spawnRandomDoll(1.0);
    return;
  }

  if (doll.hitTest(px, py)) {
    triggerCrackAndShrink();
  } else {
    spawnRandomDoll(1.0);
  }
}

// ====== 输入：倾斜优先，否则鼠标 ======
function getInputValue() {
  if (hasDeviceTilt) return constrain(tiltGamma / 35, -1, 1);
  const v = (mouseX - width / 2) / (width / 2);
  return constrain(v, -1, 1);
}

// ====== 选择当前平台要用的图 ======
function getAssetList() {
  // 手机端优先用缓存缩放图；如果缓存尚未完成就用原图兜底
  if (IS_MOBILE && C_mobile.length === TOTAL) return C_mobile;
  return C_raw;
}

// ====== 手机端缓存缩放：降低每帧绘制负载（桌面不做）=====
function buildMobileCache() {
  C_mobile = [];

  // 目标：让图片最大边接近屏幕尺寸（不需要比屏幕更大）
  const targetMax = Math.max(width, height) * (pixelDensity() || 1) * 0.95;

  for (let i = 0; i < C_raw.length; i++) {
    const src = C_raw[i];

    const scale = Math.min(1, targetMax / Math.max(src.width, src.height));
    const w = Math.max(1, Math.floor(src.width * scale));
    const h = Math.max(1, Math.floor(src.height * scale));

    // 复制再 resize，避免改坏原图（桌面要用）
    const img = src.get();
    img.resize(w, h);
    C_mobile.push(img);
  }
}

// ====== 生成随机娃娃 ======
function spawnRandomDoll(scale = 1.0) {
  const list = getAssetList();
  const img = random(list);

  const fit = getFitScale(img, FIT_RATIO);
  const finalScale = scale * fit;

  doll = new RolyDoll(img, width / 2, height / 2, finalScale);
}

function getFitScale(img, ratio) {
  const maxW = width * ratio;
  const maxH = height * ratio;
  return min(maxW / img.width, maxH / img.height);
}

// ====== 计算下一次缩放（温和缩小 + 下限）=====
function computeNextScale(img, currentScale) {
  const fit = getFitScale(img, FIT_RATIO);
  const minScale = fit * MIN_SCALE_ABS;

  let s = currentScale * SHRINK_FACTOR;
  s = max(s, minScale);
  return s;
}

function triggerCrackAndShrink() {
  const img = doll.img; // 当前平台图（桌面原图 / 手机缓存图）
  const currentScale = doll.scale;

  crackFall = new CrackFall(
    img,
    width / 2,
    height / 2,
    currentScale,
    currentScale,
  );
  doll = null;
}

// =====================
// 类：不倒翁娃娃
// =====================
class RolyDoll {
  constructor(img, x, y, scale) {
    this.img = img;
    this.x = x;
    this.y = y;
    this.scale = scale;

    this.angle = 0;
    this.angVel = 0;
    this.t = random(0, 1000);
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
  }

  update(input) {
    const target = input * MAX_ANGLE;

    const torqueInput = (target - this.angle) * INPUT_TORQUE;
    const torqueRestore = -this.angle * RESTORE_K;
    const angAcc = torqueInput + torqueRestore;

    this.angVel += angAcc;
    this.angVel *= DAMPING;
    this.angle += this.angVel;

    this.t += 1;
  }

  render() {
    push();
    translate(this.x, this.y);

    const w = this.img.width * this.scale;
    const h = this.img.height * this.scale;

    const pivotY = h * 0.2;
    const sway = sin(this.t * IDLE_SWAY_SPEED) * IDLE_SWAY_AMP;

    translate(0, pivotY);
    rotate(this.angle + sway);
    translate(0, -pivotY);

    image(this.img, 0, 0, w, h);
    pop();
  }

  hitTest(px, py) {
    const w = this.img.width * this.scale;
    const h = this.img.height * this.scale;
    return (
      px >= this.x - w / 2 &&
      px <= this.x + w / 2 &&
      py >= this.y - h / 2 &&
      py <= this.y + h / 2
    );
  }
}

// =====================
// 类：裂开 + 下落 + 渐隐（不交叉）
// =====================
class CrackFall {
  constructor(img, x, y, scale, nextScaleBase) {
    this.img = img;
    this.baseX = x;
    this.baseY = y;
    this.scale = scale;
    this.nextScaleBase = nextScaleBase;

    this.phase = 0;
    this.frame = 0;
    this.done = false;

    this.left = {
      x: x,
      y: y,
      vx: -0.8,
      vy: -0.2,
      rot: -random(2, 6),
      rv: -random(1.2, 2.2),
    };
    this.right = {
      x: x,
      y: y,
      vx: 0.8,
      vy: -0.2,
      rot: random(2, 6),
      rv: random(1.2, 2.2),
    };
  }

  setBase(x, y) {
    const dx = x - this.baseX;
    const dy = y - this.baseY;
    this.baseX = x;
    this.baseY = y;

    this.left.x += dx;
    this.left.y += dy;
    this.right.x += dx;
    this.right.y += dy;
  }

  update() {
    this.frame++;
    const gap = this.img.width * this.scale * MIN_GAP_RATIO;

    if (this.phase === 0) {
      const t = constrain(this.frame / CRACK_OPEN_FRAMES, 0, 1);
      const open = easeOutCubic(t);

      const sep = open * (this.img.width * this.scale * 0.12);
      this.left.x = this.baseX - sep;
      this.right.x = this.baseX + sep;

      this.enforceNoCross(gap);

      const lift = (1 - open) * (this.img.height * this.scale * 0.02);
      this.left.y = this.baseY - lift;
      this.right.y = this.baseY - lift;

      if (this.frame >= CRACK_OPEN_FRAMES) {
        this.phase = 1;
        this.frame = 0;

        this.left.vx = -random(1.4, 2.8);
        this.right.vx = random(1.4, 2.8);
        this.left.vy = random(-2.2, -0.6);
        this.right.vy = random(-2.2, -0.6);
      }
      return;
    }

    this.left.vy += GRAVITY;
    this.right.vy += GRAVITY;

    this.left.x += this.left.vx;
    this.left.y += this.left.vy;
    this.right.x += this.right.vx;
    this.right.y += this.right.vy;

    this.left.vx *= 0.985;
    this.right.vx *= 0.985;
    this.left.vy *= 0.99;
    this.right.vy *= 0.99;

    this.left.rot += this.left.rv;
    this.right.rot += this.right.rv;
    this.left.rv *= 0.985;
    this.right.rv *= 0.985;

    this.enforceNoCross(gap);

    if (this.frame >= FALL_FADE_FRAMES) this.done = true;
  }

  enforceNoCross(gap) {
    const overlap = this.left.x + gap - this.right.x;
    if (overlap >= 0) {
      const push = overlap / 2 + 0.5;
      this.left.x -= push;
      this.right.x += push;

      this.left.vx = min(this.left.vx, -0.3);
      this.right.vx = max(this.right.vx, 0.3);

      this.left.rot = min(this.left.rot, -0.5);
      this.right.rot = max(this.right.rot, 0.5);
      this.left.rv = min(this.left.rv, -0.2);
      this.right.rv = max(this.right.rv, 0.2);
    }
  }

  render() {
    const w = this.img.width * this.scale;
    const h = this.img.height * this.scale;

    let alpha = 255;
    if (this.phase === 1) {
      alpha = constrain(map(this.frame, 0, FALL_FADE_FRAMES, 255, 0), 0, 255);
    }

    const sw = this.img.width / 2;
    const sh = this.img.height;

    push();
    tint(255, alpha);

    push();
    translate(this.left.x, this.left.y);
    rotate(this.left.rot);
    image(this.img, 0, 0, w / 2, h, 0, 0, sw, sh);
    pop();

    push();
    translate(this.right.x, this.right.y);
    rotate(this.right.rot);
    image(this.img, 0, 0, w / 2, h, sw, 0, sw, sh);
    pop();

    noTint();
    pop();
  }
}

function easeOutCubic(t) {
  return 1 - pow(1 - t, 3);
}

// ====== 设备倾斜 ======
function setupDeviceOrientation() {
  if (!window.DeviceOrientationEvent) return;
  window.addEventListener("deviceorientation", (e) => {
    if (typeof e.gamma === "number") {
      tiltGamma = e.gamma;
      hasDeviceTilt = true;
    }
  });
}

// iOS 13+ 权限
function requestIOSPermissionIfNeeded() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    D.requestPermission()
      .then(() => {})
      .catch(() => {});
  }
}
