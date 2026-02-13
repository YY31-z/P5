let C = [];
const TOTAL = 11;

// ===== 设备倾斜 =====
let tiltGamma = 0;
let hasDeviceTilt = false;

// ===== 当前娃娃（静态可交互）=====
let doll = null;

// ===== 裂开下落动画对象（一次只播一个）=====
let crackFall = null;

// ===== 参数 =====
const FIT_RATIO = 0.62;

// 不倒翁物理（弹簧 + 阻尼 + 回正）
const INPUT_TORQUE = 0.22; // 输入推力矩（越大越跟手）
const RESTORE_K = 0.085; // 回正力度（越大越像不倒翁）
const DAMPING = 0.86; // 阻尼（越小晃得越久）
const MAX_ANGLE = 24; // 最大倾斜角

const IDLE_SWAY_SPEED = 0.03; // 微摆动
const IDLE_SWAY_AMP = 1.6;

// 缩小（差距不要太大）
const SHRINK_FACTOR = 0.94;
const MIN_SCALE_ABS = 0.08;

// 裂开与下落
const CRACK_OPEN_FRAMES = 10;
const FALL_FADE_FRAMES = 60;
const GRAVITY = 0.55;

// 防交叉：最小水平间距（随尺寸变化）
const MIN_GAP_RATIO = 0.06; // gap = imgWidth*scale*MIN_GAP_RATIO

function preload() {
  for (let i = 1; i <= TOTAL; i++) {
    C.push(loadImage(`assets/C/C${i}.png`));
  }
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  imageMode(CENTER);
  angleMode(DEGREES);

  spawnRandomDoll(1.0);
  setupDeviceOrientation();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (doll) doll.setPosition(width / 2, height / 2);
  if (crackFall) crackFall.setBase(width / 2, height / 2);
}

function draw() {
  background(255);

  const input = getInputValue();

  // 播裂开下落动画
  if (crackFall) {
    crackFall.update();
    crackFall.render();

    if (crackFall.done) {
      // 动画结束：出现更小的同款娃娃
      const img = crackFall.img;
      const nextScale = computeNextScale(img, crackFall.nextScaleBase);
      doll = new RolyDoll(img, width / 2, height / 2, nextScale);
      crackFall = null;
    }
    return;
  }

  // 正常显示娃娃
  if (doll) {
    doll.update(input);
    doll.render();
  }
}

// ===== 输入：倾斜优先，否则鼠标 =====
function getInputValue() {
  if (hasDeviceTilt) return constrain(tiltGamma / 35, -1, 1);
  const v = (mouseX - width / 2) / (width / 2);
  return constrain(v, -1, 1);
}

// ===== 交互 =====
// 点空白：生成新随机娃娃（正常尺寸）
// 点娃娃：裂开->下落消失->出现更小同款娃娃（可无限变小）
function mousePressed() {
  requestIOSPermissionIfNeeded();

  if (crackFall) return;

  if (!doll) {
    spawnRandomDoll(1.0);
    return;
  }

  if (doll.hitTest(mouseX, mouseY)) {
    triggerCrackAndShrink();
  } else {
    spawnRandomDoll(1.0);
  }
}

// ===== 生成随机娃娃 =====
function spawnRandomDoll(scale = 1.0) {
  const img = random(C);
  const fit = getFitScale(img, FIT_RATIO);
  const finalScale = scale * fit;
  doll = new RolyDoll(img, width / 2, height / 2, finalScale);
}

function getFitScale(img, ratio) {
  const maxW = width * ratio;
  const maxH = height * ratio;
  return min(maxW / img.width, maxH / img.height);
}

// ===== 计算下一次缩放（温和缩小 + 下限）=====
function computeNextScale(img, currentScale) {
  const fit = getFitScale(img, FIT_RATIO);
  const minScale = fit * MIN_SCALE_ABS;

  let s = currentScale * SHRINK_FACTOR;
  s = max(s, minScale);
  return s;
}

function triggerCrackAndShrink() {
  const img = doll.img;
  const currentScale = doll.scale;

  // 把当前娃娃交给裂开动画
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
// 类：不倒翁娃娃（弹簧/阻尼）
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

    // 底部支点
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
// 类：裂开 + 下落 + 渐隐（不交叉版本）
// 用同一张图切成左右两半
// =====================
class CrackFall {
  constructor(img, x, y, scale, nextScaleBase) {
    this.img = img;
    this.baseX = x;
    this.baseY = y;
    this.scale = scale;
    this.nextScaleBase = nextScaleBase;

    this.phase = 0; // 0裂开 1下落
    this.frame = 0;
    this.done = false;

    // 强制：左半永远向左外翻（rot/rv 负），右半向右外翻（正）
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

    // gap：随尺寸变化，保证左右不交叉
    const gap = this.img.width * this.scale * MIN_GAP_RATIO;

    if (this.phase === 0) {
      // 裂开阶段：严格按 baseX 对称向外分离，不可能交叉
      const t = constrain(this.frame / CRACK_OPEN_FRAMES, 0, 1);
      const open = easeOutCubic(t);

      const sep = open * (this.img.width * this.scale * 0.12);

      // 强制分离：左在 baseX - sep，右在 baseX + sep
      this.left.x = this.baseX - sep;
      this.right.x = this.baseX + sep;

      // 再加一次硬约束（理论不会触发，但更安全）
      this.enforceNoCross(gap);

      // 轻微上弹
      const lift = (1 - open) * (this.img.height * this.scale * 0.02);
      this.left.y = this.baseY - lift;
      this.right.y = this.baseY - lift;

      if (this.frame >= CRACK_OPEN_FRAMES) {
        this.phase = 1;
        this.frame = 0;

        // 进入下落：速度方向固定向外（防交叉）
        this.left.vx = -random(1.4, 2.8);
        this.right.vx = random(1.4, 2.8);
        this.left.vy = random(-2.2, -0.6);
        this.right.vy = random(-2.2, -0.6);
      }
      return;
    }

    // 下落阶段：重力 + 阻尼
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

    // ⭐关键：每一帧强制不交叉（位置+速度一起修正）
    this.enforceNoCross(gap);

    if (this.frame >= FALL_FADE_FRAMES) {
      this.done = true;
    }
  }

  enforceNoCross(gap) {
    // 若 left.x 追上/超过 right.x - gap，就把它们推开
    const overlap = this.left.x + gap - this.right.x;
    if (overlap >= 0) {
      const push = overlap / 2 + 0.5; // +0.5 防抖
      this.left.x -= push;
      this.right.x += push;

      // 同时修正速度：左更向左，右更向右
      this.left.vx = min(this.left.vx, -0.3);
      this.right.vx = max(this.right.vx, 0.3);

      // 旋转方向再锁一次，避免视觉“翻回来”造成像交叉
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
      alpha = map(this.frame, 0, FALL_FADE_FRAMES, 255, 0);
      alpha = constrain(alpha, 0, 255);
    }

    const sw = this.img.width / 2;
    const sh = this.img.height;

    push();
    tint(255, alpha);

    // 左半
    push();
    translate(this.left.x, this.left.y);
    rotate(this.left.rot);
    image(this.img, 0, 0, w / 2, h, 0, 0, sw, sh);
    pop();

    // 右半
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

// ===== 设备倾斜 =====
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
